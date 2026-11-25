// Keeping keyboard focus when the control that had it goes away: Done becomes Undo, a menu that
// closes with its row's new state. Focus would fall to the page and a screen reader start over.
import { tick } from 'svelte';

/** After the next update: when focus fell to the page, put it on the first match of `selector`. */
export async function keepFocus(selector: string) {
	await tick();
	const at = document.activeElement;
	if (at && at !== document.body && at.isConnected) return;
	document.querySelector<HTMLElement>(selector)?.focus();
}

/** A list row (EditableList) by its key. */
export const rowOf = (key: string) => `li[data-key="${CSS.escape(key)}"]`;
