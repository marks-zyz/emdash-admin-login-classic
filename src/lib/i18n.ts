import { en, type Strings } from "../locales/en.js";
import { ptBR } from "../locales/pt-BR.js";

export type { Strings };

/** To add a language: create src/locales/<tag>.ts typed as `Strings` and register it here. */
export const LOCALES = { en, "pt-BR": ptBR } satisfies Record<string, Strings>;
export type Locale = keyof typeof LOCALES;

const TAGS = Object.keys(LOCALES) as Locale[];
const base = (tag: string) => tag.toLowerCase().split("-")[0];

export const strings = (locale: Locale): Strings => LOCALES[locale];

export function isLocale(value: unknown): value is Locale {
	return typeof value === "string" && Object.hasOwn(LOCALES, value);
}

/** First entry of a language list (Accept-Language, `<html lang>`) that we ship: exact tag, then same base language. */
function match(list: string | null | undefined): Locale | null {
	for (const part of (list ?? "").split(",")) {
		const tag = part.split(";")[0]!.trim();
		if (!tag || tag === "*") continue;
		const found = TAGS.find((t) => t.toLowerCase() === tag.toLowerCase()) ?? TAGS.find((t) => base(t) === base(tag));
		if (found) return found;
	}
	return null;
}

export function pickLocale(forced: unknown, acceptLanguage: string | null): Locale {
	return isLocale(forced) ? forced : (match(acceptLanguage) ?? "en");
}

/** EmDash keeps `<html lang>` in sync with the admin language. */
export function clientLocale(): Locale {
	const lang = typeof document !== "undefined" ? document.documentElement.lang || navigator.language : "";
	return match(lang) ?? "en";
}
