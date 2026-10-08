/**
 * POST { token }. Called by the button this package adds to EmDash's invite page. Accepts the
 * invite with the core's `validateInvite` and `completeInvite` (role and email come from the
 * invite, never from the request), signs the person in and opens "My access".
 */
import type { APIRoute } from "astro";
import { apiError, apiSuccess } from "emdash/api/route-utils";
import { LIMITS, PASSWORD_PAGE_PATH } from "../lib/config.js";
import { sha256Hex } from "../lib/hash.js";
import { clientIp, hit, rateKey } from "../lib/rate-limit.js";
import { readSecret, users, type EmdashLocals } from "../lib/runtime.js";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, session }) => {
	const emdash = (locals as { emdash?: EmdashLocals }).emdash;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	if (!session) return apiError("SESSION_UNAVAILABLE", "No session driver configured", 500);
	if (!(await readSecret())) return apiError("NOT_CONFIGURED", "Password sign-in is not configured", 500);

	const ip = clientIp(request);
	if (ip) {
		const byIp = await hit(emdash.db as Parameters<typeof hit>[0], rateKey("invite", "ip", await sha256Hex(ip)), ...LIMITS.inviteIp);
		if (!byIp.allowed) return apiError("RATE_LIMITED", "Too many requests. Try again later.", 429);
	}

	const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
	const token = typeof body?.token === "string" ? body.token : "";
	if (!token || token.length > 256) return apiError("INVALID_TOKEN", "Invalid or expired invite", 404);

	const { completeInvite, validateInvite } = await import("@emdash-cms/auth");
	const adapter = await users(emdash);
	let invite: { email: string };
	try {
		invite = await validateInvite(adapter, token);
	} catch {
		return apiError("INVALID_TOKEN", "Invalid or expired invite", 404);
	}
	// Checked before consuming: completeInvite deletes the invite first and would burn it on a duplicate.
	if (await adapter.getUserByEmail(invite.email)) return apiError("USER_EXISTS", "An account already exists", 409);

	let user: { id: string };
	try {
		user = await completeInvite(adapter, token, {});
	} catch {
		return apiError("INVALID_TOKEN", "Invalid or expired invite", 404);
	}

	await session.regenerate();
	session.set("user", { id: user.id });
	return apiSuccess({ redirect: `${PASSWORD_PAGE_PATH}?welcome=1` });
};
