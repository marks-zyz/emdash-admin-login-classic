/** Uniform integer in [0, max) from the CSPRNG, rejecting the biased tail. */
function randomBelow(max: number): number {
	const limit = Math.floor(0x1_0000_0000 / max) * max;
	const buf = new Uint32Array(1);
	for (;;) {
		crypto.getRandomValues(buf);
		if (buf[0]! < limit) return buf[0]! % max;
	}
}

/**
 * Four words from the locale's list plus a two-digit number, e.g. "anchor-honey-puzzle-river-73".
 * About 2^39 combinations: online guessing is capped by the sign-in limits and offline attacks
 * by the Worker secret pepper; the person is also invited to replace it on the first sign-in.
 */
export function generatePassword(words: readonly string[]): string {
	const picked = Array.from({ length: 4 }, () => words[randomBelow(words.length)]!);
	return `${picked.join("-")}-${10 + randomBelow(90)}`;
}
