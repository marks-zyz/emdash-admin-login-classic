import { PASSWORD_MAX, PASSWORD_MIN } from "./config.js";
import type { Strings } from "./i18n.js";

/** Length only (NIST SP 800-63B): no composition rules, which push people to predictable patterns. */
export function passwordProblem(password: string, repeat: string, t: Strings): string | null {
	if (password.length < PASSWORD_MIN) return t.tooShort(PASSWORD_MIN);
	if (password.length > PASSWORD_MAX) return t.tooLong;
	if (password !== repeat) return t.mismatch;
	return null;
}
