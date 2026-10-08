/**
 * GET, POST, DELETE and PATCH on the signed-in person's own password. Private route: EmDash's
 * middleware demands a session (and `X-EmDash-Request` on writes). Setting a password needs no
 * current one, the same rule EmDash applies to "Add passkey". Only a browser session may write:
 * an API token also reaches private routes, and a leaked token must not become a permanent
 * password. Every write emails a notice to the account.
 */
import type { APIRoute } from "astro";
import { apiError, apiSuccess } from "emdash/api/route-utils";
import { LIMITS } from "../lib/config.js";
import { hashPassword } from "../lib/hash.js";
import { esc } from "../lib/html.js";
import { pickLocale, strings } from "../lib/i18n.js";
import { passwordProblem } from "../lib/policy.js";
import { hit, rateKey } from "../lib/rate-limit.js";
import { defer, providerConfig, readSecret, siteOrigin, stores, users, type EmdashLocals } from "../lib/runtime.js";

export const prerender = false;

interface SignedIn {
	id: string;
	email: string;
	name: string | null;
	disabled?: boolean;
}

function context(locals: unknown) {
	const l = locals as { emdash?: EmdashLocals; user?: SignedIn };
	return { emdash: l.emdash, user: l.user };
}

export const GET: APIRoute = async ({ locals }) => {
	const { emdash, user } = context(locals);
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	if (!user || user.disabled) return apiError("NOT_AUTHENTICATED", "Sign in first", 401);
	const { credentials } = await stores(emdash);
	const credential = await credentials.get(user.id);
	return apiSuccess({
		hasPassword: !!credential,
		updatedAt: credential?.updatedAt ?? null,
		temporary: !!credential?.temporary,
		passkeyOfferDismissed: !!credential?.passkeyOfferDismissed,
		name: user.name,
		email: user.email,
	});
};

export const POST: APIRoute = async ({ request, locals, session }) => {
	const { emdash, user } = context(locals);
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	// The middleware already guarantees both; checked again because this route writes a credential.
	if (!user || user.disabled) return apiError("NOT_AUTHENTICATED", "Sign in first", 401);
	const sessionUser = (await session?.get("user")) as { id?: string } | undefined;
	if (sessionUser?.id !== user.id) return apiError("SESSION_REQUIRED", "Use the admin in a browser to set a password", 403);
	const secret = await readSecret();
	if (!secret) return apiError("NOT_CONFIGURED", "Password sign-in is not configured", 500);

	const limit = await hit(emdash.db as Parameters<typeof hit>[0], rateKey("set", "user", user.id), ...LIMITS.setPasswordUser);
	if (!limit.allowed) return apiError("RATE_LIMITED", "Too many attempts. Try again later.", 429);

	const locale = pickLocale(providerConfig(emdash).locale, request.headers.get("accept-language"));
	const t = strings(locale);
	const body = (await request.json().catch(() => null)) as { password?: unknown; repeat?: unknown; name?: unknown } | null;
	const password = typeof body?.password === "string" ? body.password : "";
	const repeat = typeof body?.repeat === "string" ? body.repeat : "";
	const problem = passwordProblem(password, repeat, t);
	if (problem) return apiError("VALIDATION_ERROR", problem, 400);

	const { credentials } = await stores(emdash);
	const previous = await credentials.get(user.id);
	const replaced = !!previous;
	// A personal password ends the temporary state; the passkey answer is kept.
	await credentials.put(user.id, {
		hash: await hashPassword(password, secret),
		updatedAt: new Date().toISOString(),
		...(previous?.passkeyOfferDismissed ? { passkeyOfferDismissed: true } : {}),
	});

	// A first name for people who joined through an invite (EmDash's invite page keeps the name it asked for).
	const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
	if (name && !user.name) await (await users(emdash)).updateUser(user.id, { name });

	const mail = emdash.email;
	const origin = await siteOrigin(emdash);
	if (mail?.isAvailable() && origin) {
		const site = new URL(origin).host;
		const subject = replaced ? t.changedSubject(site) : t.addedSubject(site);
		const text = replaced ? t.changedBody(site) : t.addedBody(site);
		await defer(mail.send({ to: user.email, subject, text, html: `<p>${esc(text)}</p>` }, "system"), "password notice failed");
	}
	return apiSuccess({ success: true });
};

/** Refused without at least one passkey, so nobody is left with only the email link by accident. */
export const DELETE: APIRoute = async ({ request, locals, session }) => {
	const { emdash, user } = context(locals);
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	if (!user || user.disabled) return apiError("NOT_AUTHENTICATED", "Sign in first", 401);
	const sessionUser = (await session?.get("user")) as { id?: string } | undefined;
	if (sessionUser?.id !== user.id) return apiError("SESSION_REQUIRED", "Use the admin in a browser to change sign-in methods", 403);

	const limit = await hit(emdash.db as Parameters<typeof hit>[0], rateKey("set", "user", user.id), ...LIMITS.setPasswordUser);
	if (!limit.allowed) return apiError("RATE_LIMITED", "Too many attempts. Try again later.", 429);

	const adapter = await users(emdash);
	if ((await adapter.countCredentialsByUserId(user.id)) < 1) {
		return apiError("NO_PASSKEY", "Create a passkey before removing the password", 400);
	}
	const { credentials } = await stores(emdash);
	if (!(await credentials.delete(user.id))) return apiError("NO_PASSWORD", "There is no password to remove", 404);

	const mail = emdash.email;
	const origin = await siteOrigin(emdash);
	if (mail?.isAvailable() && origin) {
		const t = strings(pickLocale(providerConfig(emdash).locale, request.headers.get("accept-language")));
		const site = new URL(origin).host;
		await defer(
			mail.send({ to: user.email, subject: t.removedSubject(site), text: t.removedBody(site), html: `<p>${esc(t.removedBody(site))}</p>` }, "system"),
			"password removal notice failed",
		);
	}
	return apiSuccess({ success: true });
};

/** The person answered "Not now" to the passkey offer: never shown again. */
export const PATCH: APIRoute = async ({ request, locals, session }) => {
	const { emdash, user } = context(locals);
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	if (!user || user.disabled) return apiError("NOT_AUTHENTICATED", "Sign in first", 401);
	const sessionUser = (await session?.get("user")) as { id?: string } | undefined;
	if (sessionUser?.id !== user.id) return apiError("SESSION_REQUIRED", "Use the admin in a browser", 403);
	const body = (await request.json().catch(() => null)) as { passkeyOffer?: unknown } | null;
	if (body?.passkeyOffer !== "dismissed") return apiError("VALIDATION_ERROR", "Unknown change", 400);
	const { credentials } = await stores(emdash);
	const current = await credentials.get(user.id);
	if (!current) return apiError("NO_PASSWORD", "There is no password record", 404);
	await credentials.put(user.id, { ...current, passkeyOfferDismissed: true });
	return apiSuccess({ success: true });
};
