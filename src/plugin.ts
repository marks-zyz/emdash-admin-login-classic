import { definePlugin } from "emdash";
import { PLUGIN_ID, VERSION, type PasswordAuthConfig } from "./lib/config.js";
import { pickLocale, strings } from "./lib/i18n.js";

// Admin pages only: the data comes from this package's private routes, so no capability is needed.
export function createPlugin(config: PasswordAuthConfig = {}) {
	const t = strings(pickLocale(config.locale, null));
	return definePlugin({
		id: PLUGIN_ID,
		version: VERSION,
		admin: {
			entry: "emdash-admin-login-classic/plugin-admin",
			pages: [
				{ path: "/", label: t.pageTitle, icon: "lock-key" },
				// Administrators only: the route refuses everyone else, and sites can hide the menu item by role.
				{ path: "/team", label: t.accessTitle, icon: "users" },
			],
		},
	});
}
