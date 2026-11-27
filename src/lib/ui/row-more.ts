// A row's ⋯ on a list page (Habits, Library: Rename, Archive), and where the focus goes after each act. A row is
// EditableList's li[data-key] > .card, its ⋯ the button in its .verb.
import { tick } from 'svelte';

const card = (key: string) => `li[data-key="${CSS.escape(key)}"] > .card`;

/** Rename opened the row's name as a box (InlineText, opened by the page): put the cursor in it, the text selected. */
export async function focusBox(key: string) {
	await tick();
	const box = document.querySelector<HTMLInputElement>(`${card(key)} input.inline-text`);
	box?.focus();
	box?.select();
}

/** The box closed: Enter or Esc leave the focus nowhere, so it goes back to the row's ⋯; a press elsewhere keeps its own. */
export async function backToMore(key: string) {
	await tick();
	if (document.activeElement === document.body) document.querySelector<HTMLElement>(`${card(key)} > .verb button`)?.focus();
}

/** The first of `list` after `at` that is still `here`, else the nearest before it. */
export function nextHere<T>(list: T[], at: number, here: (t: T) => boolean): T | undefined {
	return list.slice(at + 1).find(here) ?? list.slice(0, Math.max(at, 0)).reverse().find(here);
}

/**
 * Archive from a row's ⋯: the row may leave. Its list hands the focus to the row taking its place; when it was its list's
 * last row (an Area's only habit, the last one inside a routine) the next row's ⋯ on the page takes it, or the one before.
 */
export async function keepFocus(change: () => unknown) {
	// The ⋯ buttons only, never the items of their (hidden) menus, which can't take the focus.
	const mores = [...document.querySelectorAll<HTMLElement>('.elist > li > .card > .verb button[aria-haspopup="menu"]')];
	const at = mores.indexOf(document.activeElement as HTMLElement);
	const done = change();
	await tick();
	if (at >= 0 && document.activeElement === document.body) nextHere(mores, at, (b) => b.isConnected)?.focus();
	return done;
}
