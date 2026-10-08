import type { Locale } from "./i18n.js";

/**
 * Every identifier that lives in a namespace shared with other packages derives from this slug:
 * the npm name without "emdash-", unique among packages named emdash-*.
 */
export const SLUG = "admin-login-classic";
export const PROVIDER_ID = SLUG;
export const PLUGIN_ID = SLUG;
export const VERSION = "0.5.0";

export const BASE_PATH = `/_emdash/api/auth/${SLUG}`;
export const ADMIN_PATH = "/_emdash/admin";
export const LOGIN_PATH_PUBLIC = "/_emdash/admin/login";
/** The plugin pages: `/_emdash/admin/plugins/<plugin-id><path>`. */
export const PASSWORD_PAGE_PATH = `${ADMIN_PATH}/plugins/${PLUGIN_ID}/`;
export const ACCESS_PAGE_PATH = `${ADMIN_PATH}/plugins/${PLUGIN_ID}/team`;
export const SECURITY_PAGE_PATH = `${ADMIN_PATH}/settings/security`;
export const PASSKEY_API_PATH = "/_emdash/api/auth/passkey";
/** EmDash's own magic-link verify route; it forwards `redirect` to its own confirm screen. */
export const MAGIC_LINK_VERIFY_PATH = "/_emdash/api/auth/magic-link/verify";

/** Worker secret mixed into every hash (HMAC "pepper"). Hashes in a leaked backup are useless without it. */
export const SECRET_ENV = `EMDASH_${SLUG.toUpperCase().replace(/-/g, "_")}_SECRET`;
export const SECRET_MIN_LENGTH = 32;

export const PASSWORD_MIN = 10;
/** Upper bound keeps a single request from burning CPU on a huge input. */
export const PASSWORD_MAX = 256;

export const RESET_TTL_MS = 30 * 60 * 1000;

/** [max requests, window in seconds]. Stored in EmDash's `_emdash_rate_limits` table, shared by every isolate. */
export const LIMITS = {
	loginIp: [20, 900],
	/** Per account AND client IP: a stranger cannot lock the owner out from another network. */
	loginAccountIp: [5, 900],
	/** Per account, every IP together: stops distributed guessing without locking on a few misses. */
	loginAccount: [30, 900],
	forgotIp: [10, 900],
	forgotAccountIp: [3, 3600],
	forgotAccount: [10, 3600],
	inviteIp: [10, 900],
	setPasswordUser: [10, 900],
	adminAction: [30, 900],
} as const satisfies Record<string, readonly [number, number]>;

/** Collections in `_plugin_storage` under `auth:<provider id>`. */
export const STORAGE_CONFIG = {
	credentials: { indexes: [] },
};

export interface Credential {
	hash: string;
	updatedAt: string;
	/** Set by an administrator ("Team access"): sign-in lands on "My access" suggesting a new password. */
	temporary?: boolean;
	/** The first sign-in with a temporary password already landed on "My access". */
	welcomed?: boolean;
	/** The person answered "Not now" to the passkey offer: never shown again. */
	passkeyOfferDismissed?: boolean;
}

/** EmDash roles (`@emdash-cms/auth` rbac). */
export const ROLES = [10, 20, 30, 40, 50] as const;
export const ROLE_ADMIN = 50;

/** Options travel to the plugin through JSON.stringify in EmDash's generated module: keep them JSON values. */
export interface PasswordAuthConfig {
	/** Language of emails and of the "My access" menu label. Default: browser Accept-Language, then English. */
	locale?: Locale;
}
