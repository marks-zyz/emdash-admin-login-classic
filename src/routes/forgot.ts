/**
 * POST { email }. The emailed link goes to EmDash's own magic-link verify route (token in
 * `auth_tokens`, type `recovery`) with a `redirect` to "My access": the core's /magic-link/send
 * carries no redirect, so the person would land on the dashboard with no hint of what to do.
 * Same answer for every well-formed email; the token and the email go out after the response.
 */
import type { APIRoute } from "astro";
import { apiError, apiSuccess } from "emdash/api/route-utils";
import { LIMITS, MAGIC_LINK_VERIFY_PATH, PASSWORD_PAGE_PATH, RESET_TTL_MS } from "../lib/config.js";
import { sha256Hex } from "../lib/hash.js";
import { esc } from "../lib/html.js";
import { pickLocale, strings } from "../lib/i18n.js";
import { clientIp, hit, rateKey } from "../lib/rate-limit.js";
import { defer, normalizeEmail, providerConfig, readSecret, siteOrigin, users, type EmdashLocals } from "../lib/runtime.js";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
	const emdash = (locals as { emdash?: EmdashLocals }).emdash;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	if (!(await readSecret())) return apiError("NOT_CONFIGURED", "Password sign-in is not configured", 500);
	// Site-level condition, the same for every email: safe to report.
	if (!emdash.email?.isAvailable()) return apiError("EMAIL_NOT_CONFIGURED", "No email provider configured", 503);

	const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
	const email = normalizeEmail(body?.email);
	if (!email) return apiError("VALIDATION_ERROR", "Invalid email", 400);

	const db = emdash.db as Parameters<typeof hit>[0];
	const ip = clientIp(request);
	const ipId = ip ? await sha256Hex(ip) : null;
	if (ipId) {
		const byIp = await hit(db, rateKey("forgot", "ip", ipId), ...LIMITS.forgotIp);
		if (!byIp.allowed) {
			const res = apiError("RATE_LIMITED", "Too many requests. Try again later.", 429);
			res.headers.set("Retry-After", String(byIp.retryAfter));
			return res;
		}
	}
	// Per-account caps stay silent (a 429 would confirm the address is targeted): account + IP,
	// so one stranger cannot use up the owner's emails, and account alone as the outer ceiling.
	const account = await sha256Hex(email);
	const caps = await Promise.all([
		...(ipId ? [hit(db, rateKey("forgot", "acct-ip", account, ipId), ...LIMITS.forgotAccountIp)] : []),
		hit(db, rateKey("forgot", "acct", account), ...LIMITS.forgotAccount),
	]);
	const withinCaps = caps.every((c) => c.allowed);

	const adapter = await users(emdash);
	const user = await adapter.getUserByEmail(email);
	if (user && !user.disabled && withinCaps) {
		const origin = await siteOrigin(emdash);
		if (!origin) {
			console.error("[emdash-admin-login-classic] no siteUrl and no emdash:site_url: reset link not sent");
			return apiSuccess({ success: true });
		}
		const t = strings(pickLocale(providerConfig(emdash).locale, request.headers.get("accept-language")));
		const mail = emdash.email;
		await defer(
			(async () => {
				const { generateTokenWithHash } = await import("@emdash-cms/auth");
				const { token, hash } = generateTokenWithHash();
				await adapter.createToken({
					hash,
					userId: user.id,
					email: user.email,
					type: "recovery",
					expiresAt: new Date(Date.now() + RESET_TTL_MS),
				});
				const link = new URL(MAGIC_LINK_VERIFY_PATH, origin);
				link.searchParams.set("token", token);
				// `?reset=1` lets the page explain why the person is already signed in.
				link.searchParams.set("redirect", `${PASSWORD_PAGE_PATH}?reset=1`);
				const site = new URL(origin).host;
				await mail.send(
					{
						to: user.email,
						subject: t.resetSubject(site),
						text: `${t.resetIntro(site)}\n\n${link.href}\n\n${t.resetIgnore}`,
						html: `<p>${esc(t.resetIntro(site))}</p><p><a href="${esc(link.href)}">${esc(t.resetButton)}</a></p><p>${esc(t.resetIgnore)}</p>`,
					},
					"system",
				);
			})(),
			"reset email failed",
		);
	}

	return apiSuccess({ success: true });
};
