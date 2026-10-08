// End-to-end test in a real browser against a local EmDash dev site that uses this package.
//
//   SITE=<site path> D1=<local D1 sqlite> [BASE=http://localhost:4321] [LOCALE=en] [ONLY=F8,F3] \
//     bun run.mjs chromium|webkit
//
// LOCALE must match the `locale` the site passes to the package; every message the package
// renders is read from src/locales, so the test follows the translations. EmDash's own screens
// (core) are matched in English and Portuguese: add your language to CORE below.
// Needs dev@emdash.local (EmDash's dev bypass user) in that D1. Test people are removed on exit
// and, for aborted runs, at the start of the next one.
import { chromium, webkit } from "playwright";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { BASE_PATH, PLUGIN_ID, PROVIDER_ID, SLUG } from "../../src/lib/config.ts";
import { strings } from "../../src/lib/i18n.ts";

const BASE = process.env.BASE ?? "http://localhost:4321";
const LOCALE = process.env.LOCALE ?? "en";
const D1 = process.env.D1;
const which = process.argv[2];
const t = strings(LOCALE);

// fileURLToPath, not .pathname: a folder named with "#" comes out as %23 in .pathname.
const HERE = fileURLToPath(new URL(".", import.meta.url));
const SHOTS = `${HERE}shots/`;
fs.mkdirSync(SHOTS, { recursive: true });

const engine = which === "webkit" ? webkit : chromium;
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exact = (s) => new RegExp(`^${escapeRx(s)}$`, "i");

const CORE = {
  confirm: /Continue|Continuar|Confirm|Confirmar|Sign in|Entrar/i,
  start: /Get started|Começar|Start/i,
  usedLink: /invalid|expired|used|inv[aá]lid|expir|usado/i,
};
const DEV = "dev@emdash.local";
const PLUGIN = `/_emdash/admin/plugins/${PLUGIN_ID}/`;
const api = (page, path, method) =>
  page.waitForResponse((r) => r.url().includes(`${BASE_PATH}/${path}`) && r.request().method() === method);
const newPass = () => "Pw-" + randomBytes(9).toString("hex");
const sql = (q) => spawnSync("sqlite3", [D1, q]).stdout.toString().trim();
const mkToken = (type, email) => spawnSync("bun", ["mktoken.mjs", type, email], { env: process.env, cwd: HERE }).stdout.toString().trim();
const shot = (page, name, options = {}) => page.screenshot({ path: `${SHOTS}${which}-${name}.png`, ...options });

const results = [];
const csrfRejections = [];
const rec = (flow, ok, detail) => {
  results.push({ browser: which, flow, ok, detail });
  console.log(`${which} ${flow} ${ok ? "PASS" : "FAIL"} ${detail || ""}`);
};

sql(`delete from _emdash_rate_limits where key like '${SLUG}:%'`);
const E2E_PEOPLE = "select id from users where email like 'e2e-%@example.com'";
const removePeople = () =>
  sql(
    ["credentials", "auth_tokens", "oauth_accounts"].map((table) => `delete from ${table} where user_id in (${E2E_PEOPLE});`).join(" ") +
      ` delete from _plugin_storage where plugin_id='auth:${PROVIDER_ID}' and id in (${E2E_PEOPLE}); delete from users where id in (${E2E_PEOPLE});`,
  );
removePeople();

// ONLY=F8 (comma list) runs just those flows. A flow brings the ones it builds on: F3 and F7
// sign in with the password F2 sets after F1's link, F6 reuses F1's link, F5b signs in as the
// person F5 invited.
const DEPS = { F2: ["F1"], F3: ["F1", "F2"], F6: ["F1"], F7: ["F1", "F2"], F5b: ["F5"] };
const ONLY = process.env.ONLY && [...new Set(process.env.ONLY.split(",").flatMap((f) => [...(DEPS[f] ?? []), f]))];

const browser = await engine.launch();
const newCtx = async () => {
  const ctx = await browser.newContext({ locale: LOCALE });
  await ctx.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "astro-dev-toolbar{display:none!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
  });
  const page = await ctx.newPage();
  page.on("response", async (r) => {
    if (!r.url().includes("/_emdash/")) return;
    try {
      if ((await r.text()).includes("CSRF_REJECTED")) csrfRejections.push(`${r.status()} ${r.url()}`);
    } catch {}
  });
  return { ctx, page };
};

const step = async (flow, fn) => {
  if (ONLY && !ONLY.includes(flow)) return true;
  try {
    await fn();
  } catch (e) {
    rec(flow, false, String(e.message).split("\n").slice(0, 4).join(" | "));
    return false;
  }
  return true;
};

const loginForm = async (page, email, password, tag) => {
  await page.context().clearCookies();
  await page.goto(`${BASE}/_emdash/admin/login`);
  const open = page.getByRole("button", { name: t.signInWithPassword, exact: true });
  await open.waitFor({ timeout: 30000 });
  await open.click();
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await shot(page, `login-form-${tag}`);
  const response = api(page, "login", "POST");
  await page.getByRole("button", { name: t.signIn, exact: true }).last().click();
  const status = (await response).status();
  await page.waitForURL((u) => u.pathname.startsWith("/_emdash/admin") && !u.pathname.includes("/login"), { timeout: 15000 });
  return status;
};

const dismissCoreWelcome = async (page) => {
  const start = page.getByRole("button", { name: CORE.start });
  try {
    await start.waitFor({ timeout: 5000 });
    await start.click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 10000 });
  } catch {}
};

const fillNewPassword = async (page, password) => {
  const fields = page.locator('input[type="password"]');
  await fields.nth(0).fill(password);
  await fields.nth(1).fill(password);
};

const pass = newPass();
let flowOk = true;
const { page } = await newCtx();
const verifyUrl = (token, redirect) =>
  `${BASE}/_emdash/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(redirect)}`;
const resetLink = verifyUrl(mkToken("recovery", DEV), `${PLUGIN}?reset=1`);

// F1: the emailed link signs in through EmDash's confirm screen and opens "My access"
flowOk =
  (await step("F1", async () => {
    await page.goto(resetLink);
    const confirm = page.getByRole("button", { name: CORE.confirm }).first();
    await confirm.waitFor({ timeout: 30000 }); // a cold dev server compiles the admin on first load
    await shot(page, "F1-confirm");
    await confirm.click();
    await page.waitForURL((u) => u.pathname.replace(/\/$/, "") === PLUGIN.replace(/\/$/, ""), { timeout: 15000 });
    await page.getByRole("heading", { name: t.pageTitle }).waitFor({ timeout: 10000 });
    await page.getByText(t.fromReset).waitFor({ timeout: 8000 });
    rec("F1", true, "confirm screen, then My access with the reset notice");
  })) && flowOk;

// F2: choose a password; password managers get the account through autocomplete="username"
if (flowOk)
  await step("F2", async () => {
    await shot(page, "F2-before");
    const fields = page.locator('input[type="password"]');
    await fields.first().waitFor({ timeout: 10000 });
    if ((await fields.count()) < 2) throw new Error("expected two password fields");
    const username = await page.locator('input[autocomplete="username"]').inputValue();
    if (username !== DEV) throw new Error(`username field holds "${username}", expected ${DEV}`);
    await fillNewPassword(page, pass);
    const response = api(page, "me", "POST");
    await page.getByRole("button", { name: t.savePassword, exact: true }).click();
    const res = await response;
    if (res.status() !== 200) throw new Error(`POST /me ${res.status()} ${(await res.text()).slice(0, 300)}`);
    await page.getByText(t.passwordSaved).first().waitFor({ timeout: 8000 });
    await shot(page, "F2-after");
    rec("F2", true, "POST /me 200 and the saved notice");
  });

// F3: sign in with the password
if (flowOk)
  await step("F3", async () => {
    const status = await loginForm(page, DEV, pass, "F3");
    rec("F3", true, `login ${status}, landed on ${new URL(page.url()).pathname}`);
  });

// F4: forgot password
await step("F4", async () => {
  await page.context().clearCookies();
  await page.goto(`${BASE}/_emdash/admin/login`);
  await page.getByRole("button", { name: t.signInWithPassword, exact: true }).click();
  await page.getByText(t.forgot).first().click();
  await page.locator('input[type="email"], input[name="email"]').first().fill(DEV);
  const response = api(page, "forgot", "POST");
  await page.getByRole("button", { name: t.sendLink, exact: true }).click();
  const res = await response;
  if (res.status() !== 200) throw new Error(`forgot ${res.status()} ${(await res.text()).slice(0, 300)}`);
  await page.getByText(t.sent).waitFor({ timeout: 8000 });
  await shot(page, "F4-forgot");
  rec("F4", true, "forgot 200 and the confirmation text");
});

// F5: an invite accepted with a password, then a sign-in as that person
const inviteEmail = `e2e-${randomBytes(4).toString("hex")}@example.com`;
const invitePass = newPass();
const invited = await newCtx();
const f5ok = await step("F5", async () => {
  const p = invited.page;
  await p.goto(`${BASE}/_emdash/admin/invite/accept?token=${encodeURIComponent(mkToken("invite", inviteEmail))}`);
  const accept = p.getByRole("button", { name: t.acceptWithPassword, exact: true });
  await accept.waitFor({ timeout: 10000 });
  await shot(p, "F5-invite");
  const response = api(p, "invite", "POST");
  await accept.click();
  const res = await response;
  if (res.status() !== 200) throw new Error(`invite ${res.status()} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  await p.waitForURL((u) => u.pathname.startsWith(PLUGIN.replace(/\/$/, "")) && u.search.includes("welcome=1"), { timeout: 15000 });
  await p.getByText(t.welcome).waitFor({ timeout: 8000 });
  await shot(p, "F5-welcome");
  await dismissCoreWelcome(p);
  await p.locator('input[type="password"]').first().waitFor({ timeout: 10000 });
  const username = await p.locator('input[autocomplete="username"]').inputValue();
  if (username !== inviteEmail) throw new Error(`username field holds "${username}", expected ${inviteEmail}`);
  const name = p.locator('input[autocomplete="name"]').first();
  if (await name.count()) await name.fill("E2E Invitee");
  await fillNewPassword(p, invitePass);
  const save = api(p, "me", "POST");
  await p.getByRole("button", { name: t.savePassword, exact: true }).click();
  const saved = await save;
  if (saved.status() !== 200) throw new Error(`invite /me ${saved.status()} ${(await saved.text()).slice(0, 300)}`);
  rec("F5", true, "invite 200, welcome notice, first password saved");
});
if (f5ok)
  await step("F5b", async () => {
    const status = await loginForm(invited.page, inviteEmail, invitePass, "F5");
    rec("F5b", true, `invited person signs in, status ${status}`);
  });

// F6: a used link is refused and creates no session
await step("F6", async () => {
  const c = await newCtx();
  await c.page.goto(resetLink);
  const confirm = c.page.getByRole("button", { name: CORE.confirm }).first();
  await confirm.waitFor({ timeout: 10000 });
  await confirm.click();
  await c.page.getByText(CORE.usedLink).first().waitFor({ timeout: 8000 });
  await shot(c.page, "F6-used");
  if (new URL(c.page.url()).pathname.startsWith("/_emdash/admin/plugins")) throw new Error("a used link reached the plugin page (a session was created)");
  rec("F6", true, "used link refused");
});

// F7: removing the password is offered and accepted only with at least one passkey
if (flowOk)
  await step("F7", async () => {
    await loginForm(page, DEV, pass, "F7");
    await page.goto(`${BASE}${PLUGIN}`);
    await page.getByRole("heading", { name: t.pageTitle }).waitFor({ timeout: 20000 });
    await page.getByText(t.passkeyNone).waitFor({ timeout: 10000 });
    if (await page.getByRole("button", { name: t.removePassword }).count()) throw new Error("remove button visible without a passkey");
    const refused = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/me`, { method: "DELETE", credentials: "same-origin", headers: { "X-EmDash-Request": "1" } });
      return { status: r.status, body: await r.text() };
    }, BASE_PATH);
    if (refused.status !== 400 || !refused.body.includes("NO_PASSKEY")) throw new Error(`DELETE without a passkey: ${refused.status} ${refused.body.slice(0, 120)}`);
    const devId = sql(`select id from users where email='${DEV}'`);
    const fakeId = "e2e-fake-" + randomBytes(4).toString("hex");
    sql(`insert into credentials (id, user_id, public_key, counter, device_type, backed_up, name) values ('${fakeId}', '${devId}', x'00', 0, 'singleDevice', 0, 'e2e')`);
    try {
      await page.reload();
      await page.getByText(t.passkeyCount(1)).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: t.removePassword }).click();
      const response = api(page, "me", "DELETE");
      await page.getByRole("button", { name: t.removeYes, exact: true }).click();
      const res = await response;
      if (res.status() !== 200) throw new Error(`DELETE ${res.status()}`);
      await page.getByText(t.passwordRemoved).waitFor({ timeout: 8000 });
      await shot(page, "F7-removed");
      const other = await newCtx();
      await other.page.goto(`${BASE}/_emdash/admin/login`);
      await other.page.getByRole("button", { name: t.signInWithPassword, exact: true }).click();
      await other.page.locator('input[type="email"]').first().fill(DEV);
      await other.page.locator('input[type="password"]').first().fill(pass);
      const attempt = api(other.page, "login", "POST");
      await other.page.getByRole("button", { name: t.signIn, exact: true }).last().click();
      const status = (await attempt).status();
      if (status !== 401) throw new Error(`password sign-in after removal: ${status}`);
      rec("F7", true, "without a passkey the button is hidden and DELETE answers 400; with one the password goes and sign-in answers 401");
    } finally {
      sql(`delete from credentials where id='${fakeId}'`);
    }
  });

// F8: an administrator creates an access with a temporary password. The person signs in and
// lands on "My access" with the suggestion and the one-time passkey offer; the second sign-in
// goes to the home screen.
await step("F8", async () => {
  const admin = await newCtx();
  await admin.page.goto(verifyUrl(mkToken("recovery", DEV), `${PLUGIN}team`));
  const confirm = admin.page.getByRole("button", { name: CORE.confirm }).first();
  await confirm.waitFor({ timeout: 30000 });
  await confirm.click();
  await admin.page.getByRole("heading", { name: t.accessTitle, exact: true }).waitFor({ timeout: 30000 });
  const email = `e2e-team-${randomBytes(3).toString("hex")}@example.com`;
  await admin.page.getByLabel(exact(t.email)).fill(email);
  await admin.page.getByLabel(exact(t.nameLabel)).fill("E2E Client");
  const created = api(admin.page, "admin", "POST");
  await admin.page.getByRole("button", { name: t.createAccess, exact: true }).click();
  const createdRes = await created;
  if (createdRes.status() !== 200) throw new Error(`create access: ${createdRes.status()}`);
  const handover = await admin.page.locator("pre").first().innerText();
  // The password sits on the line the locale's template puts it on: find it with a sentinel.
  const passwordLine = t.handover("SITE", "URL", "EMAIL", "PASSWORD_SENTINEL").split("\n").find((l) => l.includes("PASSWORD_SENTINEL"));
  const temp = handover.match(new RegExp(escapeRx(passwordLine).replace("PASSWORD_SENTINEL", "(\\S+)")))?.[1] ?? "";
  if (!/^[a-z]+(-[a-z]+){3}-[1-9][0-9]$/.test(temp)) throw new Error(`password not in the expected shape: "${temp}"`);
  if (!handover.includes(email)) throw new Error("the handover message does not carry the email");
  await shot(admin.page, "F8-team-access");

  const first = await newCtx();
  await loginForm(first.page, email, temp, "F8");
  await first.page.waitForURL((u) => u.pathname.startsWith(PLUGIN.replace(/\/$/, "")) && u.search.includes("first=1"), { timeout: 20000 });
  await dismissCoreWelcome(first.page);
  await first.page.getByText(t.tempSuggestion).waitFor({ timeout: 15000 });
  await first.page.getByText(t.passkeyOfferTitle).waitFor({ timeout: 10000 });
  await shot(first.page, "F8-first-sign-in");

  const dismissed = api(first.page, "me", "PATCH");
  await first.page.getByRole("button", { name: t.passkeyOfferNo, exact: true }).click();
  if ((await dismissed).status() !== 200) throw new Error('PATCH "Not now" failed');
  await first.page.reload();
  await first.page.getByRole("heading", { name: t.pageTitle }).waitFor({ timeout: 20000 });
  if (await first.page.getByText(t.passkeyOfferTitle).count()) throw new Error('the passkey offer came back after "Not now"');

  const second = await newCtx();
  await loginForm(second.page, email, temp, "F8b");
  const landed = new URL(second.page.url());
  if (landed.pathname.replace(/\/$/, "") !== "/_emdash/admin" || landed.search.includes("first")) {
    throw new Error(`second sign-in with the temporary password landed on ${landed.pathname}${landed.search}`);
  }
  await shot(second.page, "F8-second-sign-in");

  await fillNewPassword(first.page, newPass());
  const changed = api(first.page, "me", "POST");
  await first.page.getByRole("button", { name: t.savePassword, exact: true }).click();
  if ((await changed).status() !== 200) throw new Error("password change failed");
  await first.page.reload();
  await first.page.getByRole("heading", { name: t.pageTitle }).waitFor({ timeout: 20000 });
  if (await first.page.getByText(t.tempSuggestion).count()) throw new Error("the temporary-password notice stayed after the change");
  await shot(first.page, "F8-after-change", { fullPage: true });

  const status = await first.page.evaluate(async (base) => (await fetch(`${base}/admin`, { credentials: "same-origin" })).status, BASE_PATH);
  if (status !== 403) throw new Error(`an Editor reached the admin route: ${status}`);
  rec("F8", true, "access created; first sign-in lands on My access with the suggestion and the passkey offer; Not now sticks; second sign-in goes home; changing the password clears the notice; an Editor gets 403 on the admin route");
});

removePeople();
rec("CSRF", csrfRejections.length === 0, csrfRejections.length ? csrfRejections.join("; ") : "no CSRF_REJECTED");
await browser.close();
fs.writeFileSync(`${HERE}result-${which}.json`, JSON.stringify(results, null, 2));
