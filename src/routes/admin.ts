/**
 * GET lists the site's people with password and passkey status; POST creates an access or issues
 * a new temporary password. Administrators only, by session or by an API token with the `admin`
 * scope: EmDash's middleware only demands a session, so the role is checked here. The password
 * is returned once and never stored in clear.
 */
import type { APIRoute } from "astro";
import { apiError, apiSuccess } from "emdash/api/route-utils";
import { LIMITS, LOGIN_PATH_PUBLIC, ROLE_ADMIN, ROLES } from "../lib/config.js";
import { hashPassword } from "../lib/hash.js";
import { pickLocale, strings } from "../lib/i18n.js";
import { hit, rateKey } from "../lib/rate-limit.js";
import { normalizeEmail, providerConfig, readSecret, siteOrigin, stores, users, type EmdashLocals } from "../lib/runtime.js";
import { generatePassword } from "../lib/words.js";

export const prerender = false;

interface Caller {
	id: string;
	role: number;
	disabled?: boolean;
}

function guard(locals: unknown): { emdash: EmdashLocals; caller: Caller } | Response {
	const l = locals as { emdash?: EmdashLocals; user?: Caller; tokenScopes?: string[] };
	if (!l.emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	if (!l.user || l.user.disabled) return apiError("NOT_AUTHENTICATED", "Sign in first", 401);
	if (l.user.role < ROLE_ADMIN) return apiError("FORBIDDEN", "Administrators only", 403);
	if (l.tokenScopes && !l.tokenScopes.includes("admin")) return apiError("FORBIDDEN", "Token needs the admin scope", 403);
	return { emdash: l.emdash, caller: l.user };
}

export const GET: APIRoute = async ({ locals }) => {
	const g = guard(locals);
	if (g instanceof Response) return g;
	const adapter = await users(g.emdash);
	const { credentials } = await stores(g.emdash);
	const people: Array<Record<string, unknown>> = [];
	let cursor: string | undefined;
	do {
		const page = await adapter.getUsers({ limit: 100, cursor });
		const creds = await credentials.getMany(page.items.map((u) => u.id));
		for (const u of page.items) {
			const c = creds.get(u.id);
			people.push({
				id: u.id,
				email: u.email,
				name: u.name,
				role: u.role,
				disabled: u.disabled,
				password: c ? (c.temporary ? "temporary" : "set") : "none",
				passkeys: u.credentialCount,
			});
		}
		cursor = page.nextCursor;
	} while (cursor);
	return apiSuccess({ items: people });
};

export const POST: APIRoute = async ({ request, locals }) => {
	const g = guard(locals);
	if (g instanceof Response) return g;
	const { emdash, caller } = g;
	const secret = await readSecret();
	if (!secret) return apiError("NOT_CONFIGURED", "Password sign-in is not configured", 500);

	const limit = await hit(emdash.db as Parameters<typeof hit>[0], rateKey("admin", "user", caller.id), ...LIMITS.adminAction);
	if (!limit.allowed) return apiError("RATE_LIMITED", "Too many requests. Try again later.", 429);

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const t = strings(pickLocale(providerConfig(emdash).locale, request.headers.get("accept-language")));
	const adapter = await users(emdash);
	const { credentials } = await stores(emdash);
	const origin = await siteOrigin(emdash);
	const loginUrl = origin ? `${origin}${LOGIN_PATH_PUBLIC}` : null;

	if (body?.action === "create") {
		const email = normalizeEmail(body.email);
		const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
		const role = Number(body.role);
		if (!email) return apiError("VALIDATION_ERROR", "Invalid email", 400);
		if (!ROLES.includes(role as (typeof ROLES)[number])) return apiError("VALIDATION_ERROR", "Invalid role", 400);
		if (await adapter.getUserByEmail(email)) return apiError("USER_EXISTS", "There is already an account for this email", 409);

		const password = generatePassword(t.words);
		const hash = await hashPassword(password, secret);
		const user = await adapter.createUser({
			email,
			name: name || null,
			role: role as (typeof ROLES)[number],
			emailVerified: true,
		});
		await credentials.put(user.id, { hash, updatedAt: new Date().toISOString(), temporary: true });
		return apiSuccess({ email: user.email, name: user.name, password, loginUrl });
	}

	if (body?.action === "reset") {
		const userId = typeof body.userId === "string" ? body.userId : "";
		const user = userId ? await adapter.getUserById(userId) : null;
		if (!user) return apiError("NOT_FOUND", "No such person", 404);
		const password = generatePassword(t.words);
		const previous = await credentials.get(user.id);
		await credentials.put(user.id, {
			hash: await hashPassword(password, secret),
			updatedAt: new Date().toISOString(),
			temporary: true,
			...(previous?.passkeyOfferDismissed ? { passkeyOfferDismissed: true } : {}),
		});
		return apiSuccess({ email: user.email, name: user.name, password, loginUrl });
	}

	return apiError("VALIDATION_ERROR", "Unknown action", 400);
};
