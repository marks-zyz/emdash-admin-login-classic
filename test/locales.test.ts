import { describe, expect, test } from "bun:test";
import { en } from "../src/locales/en.ts";
import { LOCALES } from "../src/lib/i18n.ts";

const SENTINEL = (i: number) => `§${i}§`;

describe.each(Object.entries(LOCALES))("locale %s", (tag, locale) => {
	test("has exactly the keys of the English source, with the same kinds of value", () => {
		expect(Object.keys(locale).sort()).toEqual(Object.keys(en).sort());
		for (const key of Object.keys(en) as (keyof typeof en)[]) {
			expect(typeof locale[key]).toBe(typeof en[key]);
			if (typeof en[key] === "function") expect((locale[key] as Function).length).toBe((en[key] as Function).length);
		}
	});

	test("every placeholder of every message is used", () => {
		for (const [key, value] of Object.entries(locale)) {
			if (typeof value !== "function") continue;
			const args = Array.from({ length: value.length }, (_, i) => SENTINEL(i));
			const out = String((value as (...a: string[]) => string)(...args));
			args.forEach((a) => expect(out, `${tag}.${key} drops ${a}`).toContain(a));
		}
	});

	test("roles name every EmDash role", () => {
		expect(Object.keys(locale.roles).sort()).toEqual(["10", "20", "30", "40", "50"]);
	});

	test("temporary-password words: 256+, unique, short, lowercase ASCII", () => {
		expect(locale.words.length).toBeGreaterThanOrEqual(256);
		expect(new Set(locale.words).size).toBe(locale.words.length);
		for (const w of locale.words) expect(w).toMatch(/^[a-z]{3,10}$/);
	});

	test("no em or en dashes in user-facing text", () => {
		const text = JSON.stringify(locale, (_, v) => (typeof v === "function" ? v("x", "x", "x", "x") : v));
		expect(text).not.toMatch(/[\u2013\u2014]/);
	});
});
