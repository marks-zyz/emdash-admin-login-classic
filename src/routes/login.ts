/**
 * POST { email, password }. Every failure before the password check answers the same
 * INVALID_CREDENTIALS after the same hashing work, so the response never says whether an
 * account or a password exists.
 */
import type { APIRoute } from "astro";
import { apiError, apiSuccess } from "emdash/api/route-utils";
import { LIMITS, PASSWORD_MAX, PASSWORD_PAGE_PATH } from "../lib/config.js";
import { hashPassword, needsRehash, sha256Hex, verifyDummy, verifyPassword } from "../lib/hash.js";
import { clear, clientIp, hit, rateKey } from "../lib/rate-limit.js";
import { normalizeEmail, readSecret, stores, users, type EmdashLocals } from "../lib/runtime.js";

export const prerender = false;

function limited(retryAfter: number): Response {
	const res = apiError("RATE_LIMITED", "Too many attempts. Try again later.", 429);
	res.headers.set("Retry-After", String(retryAfter));
	return res;
}

export const POST: APIRoute = async ({ request, locals, session }) => {
	const emdash = (locals as { emdash?: EmdashLocals }).emdash;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	if (!session) return apiError("SESSION_UNAVAILABLE", "No session driver configured", 500);

	const secret = await readSecret();
	if (!secret) return apiError("NOT_CONFIGURED", "Password sign-in is not configured", 500);

	const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
	const email = normalizeEmail(body?.email);
	const password = typeof body?.password === "string" ? body.password : "";
	if (!email || !password || password.length > PASSWORD_MAX) {
		return apiError("INVALID_CREDENTIALS", "Incorrect email or password", 401);
	}

	const db = emdash.db as Parameters<typeof hit>[0];
	const ip = clientIp(request);
	const ipId = ip ? await sha256Hex(ip) : null;
	if (ipId) {
		const byIp = await hit(db, rateKey("login", "ip", ipId), ...LIMITS.loginIp);
		if (!byIp.allowed) return limited(byIp.retryAfter);
	}
	// Per account, counted BEFORE the check (atomic upsert, so a parallel burst cannot read zero)
	// and cleared on success. Two keys: account + IP (5 misses) so someone on another network
	// cannot lock the owner out, and account alone (30) against guessing spread over many IPs.
	const account = await sha256Hex(email);
	const keys = [
		...(ipId ? [{ key: rateKey("login", "acct-ip", account, ipId), limit: LIMITS.loginAccountIp }] : []),
		{ key: rateKey("login", "acct", account), limit: ipId ? LIMITS.loginAccount : LIMITS.loginAccountIp },
	];
	for (const { key, limit } of keys) {
		const r = await hit(db, key, limit[0], limit[1]);
		if (!r.allowed) return limited(r.retryAfter);
	}

	const adapter = await users(emdash);
	const user = await adapter.getUserByEmail(email);
	const { credentials } = await stores(emdash);
	const credential = user ? await credentials.get(user.id) : null;

	const valid = credential
		? await verifyPassword(password, credential.hash, secret)
		: await verifyDummy(password, secret);
	if (!user || !valid) return apiError("INVALID_CREDENTIALS", "Incorrect email or password", 401);

	// Only after the right password, so it does not reveal anything to someone guessing.
	if (user.disabled) return apiError("ACCOUNT_DISABLED", "This account is disabled", 403);
	for (const { key } of keys) await clear(db, key);

	// A password made by an administrator greets the person once: only the first sign-in with it
	// lands on "My access". The mark is written here, so closing that page never brings it back.
	const firstTemporary = !!credential?.temporary && !credential.welcomed;
	if (credential && (needsRehash(credential.hash) || firstTemporary)) {
		await credentials.put(user.id, {
			...credential,
			hash: needsRehash(credential.hash) ? await hashPassword(password, secret) : credential.hash,
			...(firstTemporary ? { welcomed: true } : {}),
		});
	}

	// New session id before marking it as signed in, so a planted cookie cannot be promoted.
	await session.regenerate();
	session.set("user", { id: user.id });
	// First sign-in with a temporary password: "My access", which suggests a personal password and
	// offers a passkey once. A suggestion, never a block; every later sign-in goes to the home screen.
	return apiSuccess(firstTemporary ? { success: true, redirect: `${PASSWORD_PAGE_PATH}?first=1` } : { success: true });
};
