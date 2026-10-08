import type { AuthProviderDescriptor, PluginDescriptor } from "emdash";
import { strings, pickLocale } from "./lib/i18n.js";
import { BASE_PATH, PLUGIN_ID, PROVIDER_ID, STORAGE_CONFIG, VERSION, type PasswordAuthConfig } from "./lib/config.js";

export type { PasswordAuthConfig } from "./lib/config.js";
export { SECRET_ENV } from "./lib/config.js";

export function passwordAuth(config: PasswordAuthConfig = {}): AuthProviderDescriptor {
	return {
		id: PROVIDER_ID,
		// The core titles the form "Sign in with {label}", translated around it; the label itself is ours.
		label: strings(pickLocale(config.locale, null)).providerLabel,
		config,
		adminEntry: "emdash-admin-login-classic/admin",
		routes: [
			{ pattern: `${BASE_PATH}/login`, entrypoint: "emdash-admin-login-classic/routes/login.ts" },
			{ pattern: `${BASE_PATH}/forgot`, entrypoint: "emdash-admin-login-classic/routes/forgot.ts" },
			{ pattern: `${BASE_PATH}/invite`, entrypoint: "emdash-admin-login-classic/routes/invite.ts" },
			// Private: not in publicRoutes, so the core demands a session and X-EmDash-Request.
			{ pattern: `${BASE_PATH}/me`, entrypoint: "emdash-admin-login-classic/routes/me.ts" },
			{ pattern: `${BASE_PATH}/admin`, entrypoint: "emdash-admin-login-classic/routes/admin.ts" },
		],
		// Exact paths, not a prefix: `/me` must stay behind EmDash's session check.
		publicRoutes: [`${BASE_PATH}/login`, `${BASE_PATH}/forgot`, `${BASE_PATH}/invite`],
		storage: STORAGE_CONFIG,
	};
}

export function passwordPlugin(config: PasswordAuthConfig = {}): PluginDescriptor<PasswordAuthConfig> {
	return {
		id: PLUGIN_ID,
		version: VERSION,
		format: "native",
		entrypoint: "emdash-admin-login-classic/plugin",
		adminEntry: "emdash-admin-login-classic/plugin-admin",
		options: config,
	};
}
