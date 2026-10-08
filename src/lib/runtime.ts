import type { StorageCollection } from "emdash";
import {
	PROVIDER_ID,
	SECRET_ENV,
	SECRET_MIN_LENGTH,
	STORAGE_CONFIG,
	type Credential,
	type PasswordAuthConfig,
} from "./config.js";

export interface EmdashLocals {
	db: unknown;
	config: {
		authProviders?: Array<{ id: string; config?: unknown }>;
		siteUrl?: string;
	} & Record<string, unknown>;
	email?: {
		isAvailable(): boolean;
		send(message: { to: string; subject: string; text: string; html?: string }, source: string): Promise<void>;
	};
}

/** Worker env via `cloudflare:workers` (Astro 7 has no `locals.runtime`), then `process.env` for Node hosts. */
async function readEnv(): Promise<Record<string, unknown>> {
	try {
		const mod = (await import(/* @vite-ignore */ "cloudflare:workers")) as unknown as {
			env?: Record<string, unknown>;
		};
		if (mod?.env) return mod.env;
	} catch {
		// Not on Workers: fall back to process.env.
	}
	const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
	return (proc?.env as Record<string, unknown> | undefined) ?? {};
}

/**
 * Runs work after the response (`waitUntil` from `cloudflare:workers`); elsewhere it just lets
 * the promise run. Errors are logged, never thrown into the response.
 */
export async function defer(task: Promise<unknown>, label: string): Promise<void> {
	const guarded = task.catch((error: unknown) => {
		console.error(`[emdash-admin-login-classic] ${label}:`, error instanceof Error ? error.message : error);
	});
	try {
		const mod = (await import(/* @vite-ignore */ "cloudflare:workers")) as unknown as {
			waitUntil?: (p: Promise<unknown>) => void;
		};
		if (typeof mod?.waitUntil === "function") {
			mod.waitUntil(guarded);
			return;
		}
	} catch {
		// Not on Workers: the promise just runs.
	}
	void guarded;
}

/** The pepper secret, or null when missing or too short (routes then answer NOT_CONFIGURED). */
export async function readSecret(): Promise<string | null> {
	const value = (await readEnv())[SECRET_ENV];
	return typeof value === "string" && value.length >= SECRET_MIN_LENGTH ? value : null;
}

export interface Stores {
	credentials: StorageCollection<Credential>;
}

export async function stores(emdash: EmdashLocals): Promise<Stores> {
	const { getAuthProviderStorage } = await import("emdash/api/route-utils");
	return getAuthProviderStorage(
		emdash.db as Parameters<typeof getAuthProviderStorage>[0],
		PROVIDER_ID,
		STORAGE_CONFIG,
	) as unknown as Stores;
}

export async function users(emdash: EmdashLocals) {
	const { createKyselyAdapter } = await import("@emdash-cms/auth/adapters/kysely");
	return createKyselyAdapter(emdash.db as Parameters<typeof createKyselyAdapter>[0]);
}

export function providerConfig(emdash: EmdashLocals): PasswordAuthConfig {
	const found = emdash.config.authProviders?.find((p) => p.id === PROVIDER_ID);
	return (found?.config as PasswordAuthConfig | undefined) ?? {};
}

export function normalizeEmail(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const email = value.trim().toLowerCase();
	return email.length > 3 && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * The site's official origin for links in emails: `siteUrl` (or EMDASH_SITE_URL / SITE_URL),
 * then the `emdash:site_url` option written at setup, the same order as the core's
 * getSiteBaseUrl. Never the request's Host: a link with a valid token must not follow a header.
 */
export async function siteOrigin(emdash: EmdashLocals): Promise<string | null> {
	const env = await readEnv();
	const configured = [emdash.config.siteUrl, env.EMDASH_SITE_URL, env.SITE_URL].find(
		(v): v is string => typeof v === "string" && v.length > 0,
	);
	const candidates: unknown[] = [configured];
	if (!configured) {
		const { OptionsRepository } = await import("emdash/api/route-utils");
		const options = new OptionsRepository(emdash.db as ConstructorParameters<typeof OptionsRepository>[0]);
		candidates.push(await options.get<string>("emdash:site_url"));
	}
	for (const value of candidates) {
		if (typeof value !== "string") continue;
		try {
			const origin = new URL(value).origin;
			if (origin.startsWith("https://") || origin.startsWith("http://localhost")) return origin;
		} catch {
			// Not a URL: fall through.
		}
	}
	return null;
}
