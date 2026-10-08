/**
 * PBKDF2-SHA256 at 100,000 iterations, the ceiling of Cloudflare's production runtime
 * (workerd DEFAULT_MAX_PBKDF2_ITERATIONS): local dev accepts more and production rejects it.
 * The password goes through HMAC-SHA256 keyed by a Worker secret (pepper) first, so hashes in an
 * EmDash backup cannot be attacked offline. Stored as `pbkdf2-sha256$<iterations>$<salt>$<hash>`.
 */

export const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const PREFIX = "pbkdf2-sha256";

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
	const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Same length and every byte compared: the time does not depend on where the first difference is. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
	return diff === 0;
}

async function pepper(password: string, secret: string): Promise<Uint8Array<ArrayBuffer>> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(password)));
}

async function derive(
	peppered: Uint8Array<ArrayBuffer>,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number,
): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
		key,
		HASH_BITS,
	);
	return new Uint8Array(bits);
}

export async function hashPassword(password: string, secret: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derive(await pepper(password, secret), salt, ITERATIONS);
	return `${PREFIX}$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

/**
 * Verifies against a stored hash. A malformed value returns false instead of throwing,
 * so a corrupted row reads as "wrong password", never as a 500 that tells the two apart.
 */
export async function verifyPassword(password: string, stored: string, secret: string): Promise<boolean> {
	const parts = stored.split("$");
	if (parts.length !== 4 || parts[0] !== PREFIX) return false;
	const iterations = Number(parts[1]);
	if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
	let salt: Uint8Array<ArrayBuffer>;
	let expected: Uint8Array;
	try {
		salt = fromBase64Url(parts[2]!);
		expected = fromBase64Url(parts[3]!);
	} catch {
		return false;
	}
	const actual = await derive(await pepper(password, secret), salt, iterations);
	return constantTimeEqual(actual, expected);
}

export function needsRehash(stored: string): boolean {
	const parts = stored.split("$");
	return parts[0] !== PREFIX || Number(parts[1]) !== ITERATIONS;
}

/**
 * Burns the same work as a real verification. Called when the email has no account or no
 * password, so the response time does not reveal which emails exist.
 */
export async function verifyDummy(password: string, secret: string): Promise<false> {
	await derive(await pepper(password, secret), new Uint8Array(SALT_BYTES), ITERATIONS);
	return false;
}

/** SHA-256 hex, used to store reset tokens and rate-limit keys without the raw value. */
export async function sha256Hex(text: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
	return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
