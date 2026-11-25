// Hints stand once, beside their thing, and are gone for good when it is done or "Got it" is pressed.
export const HINTS = {
	done: 'When you did it, press the button on its row. ⋯ has the rest: skip it, log it in full, undo. Its name opens everything about it.'
} as const;
export type HintId = keyof typeof HINTS;

/** The one to show now: the first that isn't retired and whose thing is on the page. */
export function hintNow(seen: string[], here: HintId[]): HintId | null {
	return here.find((h) => !seen.includes(h)) ?? null;
}
