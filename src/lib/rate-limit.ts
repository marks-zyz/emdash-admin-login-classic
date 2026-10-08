/**
 * Counters live in EmDash's `_emdash_rate_limits` table with the same atomic upsert as the core:
 * in D1 they are shared by every Worker isolate, where an in-memory counter would reset and stop nothing.
 */

import { SLUG } from "./config.js";
import type { Kysely } from "kysely";
import { sql } from "kysely";

export interface RateResult {
	allowed: boolean;
	retryAfter: number;
}

export async function hit(
	db: Kysely<unknown>,
	key: string,
	max: number,
	windowSeconds: number,
	now = Date.now(),
): Promise<RateResult> {
	const windowMs = windowSeconds * 1000;
	const start = Math.floor(now / windowMs) * windowMs;
	const result = await sql<{ count: number }>`
		INSERT INTO _emdash_rate_limits (key, "window", count)
		VALUES (${key}, ${new Date(start).toISOString()}, 1)
		ON CONFLICT (key, "window")
		DO UPDATE SET count = _emdash_rate_limits.count + 1
		RETURNING count
	`.execute(db);
	const count = Number(result.rows[0]?.count ?? 1);
	return { allowed: count <= max, retryAfter: Math.ceil((start + windowMs - now) / 1000) };
}

export async function clear(db: Kysely<unknown>, key: string): Promise<void> {
	await sql`DELETE FROM _emdash_rate_limits WHERE key = ${key}`.execute(db);
}

/**
 * Client IP, trusted only on Cloudflare (the `cf` object exists and the edge overwrites
 * CF-Connecting-IP). Anywhere else it returns null and the caller relies on the per-email limit.
 */
export function clientIp(request: Request): string | null {
	const cf = (request as unknown as { cf?: unknown }).cf;
	if (!cf) return null;
	const ip = request.headers.get("cf-connecting-ip")?.trim();
	if (!ip || !/^[0-9a-fA-F:.]{2,45}$/.test(ip)) return null;
	// IPv4 and IPv4-mapped forms stay whole; an IPv6 that does not parse keeps its full form, never null.
	return ip.includes(":") && !ip.includes(".") ? (ipv6Prefix64(ip) ?? ip) : ip;
}

/**
 * One IPv6 customer usually holds a whole /64, so per-address limits are trivial to rotate.
 * The key is the first four groups, expanded (`2001:db8::1` -> `2001:db8:0:0::/64`).
 */
export function ipv6Prefix64(ip: string): string | null {
	const [head = "", tail, extra] = ip.split("::");
	if (extra !== undefined) return null;
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const missing = 8 - left.length - right.length;
	if (tail === undefined ? left.length !== 8 : missing < 1) return null;
	const groups = [...left, ...Array(tail === undefined ? 0 : missing).fill("0"), ...right];
	if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
	return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "").toLowerCase()).join(":")}::/64`;
}

/** Keys share one table with the core and other packages, so ours start with the slug. */
export const rateKey = (...parts: (string | number)[]) => [SLUG, ...parts].join(":");
