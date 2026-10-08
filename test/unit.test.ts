import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { safeRedirect } from "../src/admin.tsx";
import { PASSWORD_MIN, PLUGIN_ID, PROVIDER_ID, SECRET_ENV, SLUG } from "../src/lib/config.ts";
import {
	ITERATIONS,
	constantTimeEqual,
	fromBase64Url,
	hashPassword,
	needsRehash,
	randomToken,
	sha256Hex,
	toBase64Url,
	verifyDummy,
	verifyPassword,
} from "../src/lib/hash.ts";
import { LOCALES, pickLocale, strings } from "../src/lib/i18n.ts";
import { esc } from "../src/lib/html.ts";
import { passwordProblem } from "../src/lib/policy.ts";
import { clientIp, ipv6Prefix64, rateKey } from "../src/lib/rate-limit.ts";
import { normalizeEmail } from "../src/lib/runtime.ts";
import { passwordAuth, passwordPlugin } from "../src/index.ts";
import { generatePassword } from "../src/lib/words.ts";

const SECRET = "a".repeat(40);

describe("hash", () => {
	test("round trip and format", async () => {
		const stored = await hashPassword("correct horse battery", SECRET);
		expect(stored.split("$")).toHaveLength(4);
		expect(stored.startsWith(`pbkdf2-sha256$${ITERATIONS}$`)).toBe(true);
		expect(await verifyPassword("correct horse battery", stored, SECRET)).toBe(true);
	});

	test("wrong password, wrong secret", async () => {
		const stored = await hashPassword("correct horse battery", SECRET);
		expect(await verifyPassword("correct horse batterY", stored, SECRET)).toBe(false);
		expect(await verifyPassword("correct horse battery", stored, "b".repeat(40))).toBe(false);
	});

	test("same password, different salt", async () => {
		const a = await hashPassword("same password here", SECRET);
		const b = await hashPassword("same password here", SECRET);
		expect(a).not.toBe(b);
	});

	test("malformed or hostile stored values read as wrong password", async () => {
		for (const bad of ["", "x", "pbkdf2-sha256$100000$$", "bcrypt$1$a$b", `pbkdf2-sha256$${ITERATIONS + 1}$AA$AA`, "pbkdf2-sha256$0$AA$AA", "pbkdf2-sha256$100000$!!$??"]) {
			expect(await verifyPassword("anything long", bad, SECRET)).toBe(false);
		}
	});

	test("needsRehash only for other formats or counts", async () => {
		expect(needsRehash(await hashPassword("some password!", SECRET))).toBe(false);
		expect(needsRehash("pbkdf2-sha256$50000$AA$AA")).toBe(true);
		expect(needsRehash("other$1$2$3")).toBe(true);
	});

	test("dummy verification always fails", async () => {
		expect(await verifyDummy("anything", SECRET)).toBe(false);
	});

	test("constant time compare and base64url", () => {
		expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
		expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
		expect(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
		const bytes = crypto.getRandomValues(new Uint8Array(33));
		expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
		expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	test("sha256Hex", async () => {
		expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});
});

describe("policy and input", () => {
	const t = strings("en");
	test("length rule and repeat", () => {
		expect(passwordProblem("short", "short", t)).toContain(String(PASSWORD_MIN));
		expect(passwordProblem("x".repeat(300), "x".repeat(300), t)).toBe(t.tooLong);
		expect(passwordProblem("long enough pass", "long enough pasS", t)).toBe(t.mismatch);
		expect(passwordProblem("long enough pass", "long enough pass", t)).toBeNull();
	});

	test("email normalization", () => {
		expect(normalizeEmail("  Someone@Example.COM ")).toBe("someone@example.com");
		expect(normalizeEmail("no-at-sign")).toBeNull();
		expect(normalizeEmail(42)).toBeNull();
		expect(normalizeEmail(`${"a".repeat(320)}@x.io`)).toBeNull();
	});

	test("redirect stays inside the admin", () => {
		expect(safeRedirect(null)).toBe("/_emdash/admin");
		expect(safeRedirect("/_emdash/admin/content/posts")).toBe("/_emdash/admin/content/posts");
		expect(safeRedirect("https://evil.example/_emdash/admin")).toBe("/_emdash/admin");
		expect(safeRedirect("//evil.example")).toBe("/_emdash/admin");
		expect(safeRedirect("/_emdash/admin\t/evil")).toBe("/_emdash/admin");
		expect(safeRedirect("/_emdash/admin\\evil")).toBe("/_emdash/admin");
		expect(safeRedirect("/somewhere-else")).toBe("/_emdash/admin");
	});

	test("html escaping", () => {
		expect(esc(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
	});

	test("locale: forced, exact tag, base language, first supported entry, fallback", () => {
		expect(pickLocale(undefined, "pt-BR,pt;q=0.9,en;q=0.8")).toBe("pt-BR");
		expect(pickLocale(undefined, "pt-PT")).toBe("pt-BR");
		expect(pickLocale(undefined, "en-US")).toBe("en");
		expect(pickLocale(undefined, "fr-FR, pt;q=0.8, en;q=0.5")).toBe("pt-BR");
		expect(pickLocale(undefined, "fr-FR, *;q=0.1")).toBe("en");
		expect(pickLocale(undefined, null)).toBe("en");
		expect(pickLocale("pt-BR", "en-US")).toBe("pt-BR");
		expect(pickLocale("xx", "pt-BR")).toBe("pt-BR");
	});

	test("client ip only trusted with the cf object", () => {
		const plain = new Request("https://x.test", { headers: { "cf-connecting-ip": "1.2.3.4" } });
		expect(clientIp(plain)).toBeNull();
		const onCf = Object.assign(new Request("https://x.test", { headers: { "cf-connecting-ip": "1.2.3.4" } }), { cf: {} });
		expect(clientIp(onCf)).toBe("1.2.3.4");
		const spoofed = Object.assign(new Request("https://x.test", { headers: { "cf-connecting-ip": "1.2.3.4<script>" } }), { cf: {} });
		expect(clientIp(spoofed)).toBeNull();
	});

	test("IPv6 grouped by /64, IPv4 and odd forms kept whole", () => {
		expect(ipv6Prefix64("2001:db8::1")).toBe("2001:db8:0:0::/64");
		expect(ipv6Prefix64("2001:0db8:0000:0042:abcd:ef01:2345:6789")).toBe("2001:db8:0:42::/64");
		expect(ipv6Prefix64("2001:db8:0:42:1::")).toBe("2001:db8:0:42::/64");
		expect(ipv6Prefix64("::1")).toBe("0:0:0:0::/64");
		expect(ipv6Prefix64("1::2::3")).toBeNull();
		const a = Object.assign(new Request("https://x.test", { headers: { "cf-connecting-ip": "2001:db8:0:42::aaaa" } }), { cf: {} });
		const b = Object.assign(new Request("https://x.test", { headers: { "cf-connecting-ip": "2001:db8:0:42:ffff::1" } }), { cf: {} });
		expect(clientIp(a)).toBe(clientIp(b));
		const mapped = Object.assign(new Request("https://x.test", { headers: { "cf-connecting-ip": "::ffff:1.2.3.4" } }), { cf: {} });
		expect(clientIp(mapped)).toBe("::ffff:1.2.3.4");
	});
});

describe("descriptors", () => {
	test("provider: routes, exact public paths, /me stays private", () => {
		const d = passwordAuth();
		expect(d.id).toBe("admin-login-classic");
		expect(d.routes?.map((r) => r.pattern)).toEqual([
			"/_emdash/api/auth/admin-login-classic/login",
			"/_emdash/api/auth/admin-login-classic/forgot",
			"/_emdash/api/auth/admin-login-classic/invite",
			"/_emdash/api/auth/admin-login-classic/me",
			"/_emdash/api/auth/admin-login-classic/admin",
		]);
		expect(d.publicRoutes).toEqual([
			"/_emdash/api/auth/admin-login-classic/login",
			"/_emdash/api/auth/admin-login-classic/forgot",
			"/_emdash/api/auth/admin-login-classic/invite",
		]);
		expect(d.publicRoutes?.some((r) => r.endsWith("/"))).toBe(false);
		expect(Object.keys(d.storage ?? {})).toEqual(["credentials"]);
		expect(passwordAuth({ locale: "pt-BR" }).label).toBe("e-mail e senha");
	});

	test("plugin: native, admin entry, options passed through", () => {
		const p = passwordPlugin({ locale: "pt-BR" });
		expect(p).toMatchObject({ id: "admin-login-classic", format: "native", entrypoint: "emdash-admin-login-classic/plugin", adminEntry: "emdash-admin-login-classic/plugin-admin", options: { locale: "pt-BR" } });
	});
});

describe("temporary passwords", () => {
	for (const [tag, locale] of Object.entries(LOCALES)) {
		test(`${tag}: four words from its list and a two-digit number`, () => {
			const seen = new Set<string>();
			for (let i = 0; i < 200; i++) {
				const pw = generatePassword(locale.words);
				expect(pw).toMatch(/^[a-z]+(-[a-z]+){3}-[1-9][0-9]$/);
				for (const w of pw.split("-").slice(0, 4)) expect(locale.words).toContain(w);
				seen.add(pw);
			}
			expect(seen.size).toBe(200);
		});
	}

	test("admin route is registered and private", () => {
		const d = passwordAuth();
		expect(d.routes?.map((r) => r.pattern)).toContain("/_emdash/api/auth/admin-login-classic/admin");
		expect(d.publicRoutes).not.toContain("/_emdash/api/auth/admin-login-classic/admin");
	});
});

describe("shared identifiers", () => {
	test("everything derives from one slug that matches the package name", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(pkg.name).toBe(`emdash-${SLUG}`);
		expect(PROVIDER_ID).toBe(SLUG);
		expect(PLUGIN_ID).toBe(SLUG);
		expect(SECRET_ENV).toBe("EMDASH_ADMIN_LOGIN_CLASSIC_SECRET");
		expect(rateKey("login", "ip", "abc")).toBe("admin-login-classic:login:ip:abc");
	});

	test("the slug avoids the core's public route prefixes", () => {
		expect(SLUG).toMatch(/^[a-z0-9-]+$/);
		for (const reserved of ["login", "register", "dev-bypass", "setup", "signup", "invite", "magic-link", "oauth"]) {
			expect(SLUG.startsWith(reserved)).toBe(false);
		}
	});
});
