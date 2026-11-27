// The band above the tab bar: every recent change keeps its Undo, with no timer, and nothing
// covers the end of a list. Quick actions happen at once and offer Undo, instead of asking first.
import type { Snippet } from 'svelte';
import { deserialize } from '$app/forms';
import { dropEntry, oneStop, pushEntry, setHeld, type Entry } from './echo';

let next = 1;

/** An entry, with what had focus when it was posted: its Undo goes with it, and focus goes back there (Band). */
export type Posted = Entry & { from?: Element | null };

/** `select` is what a page's select mode shows in the band instead. */
export const band = $state<{ entries: Posted[]; select: Snippet | null }>({ entries: [], select: null });

const post = (e: Omit<Entry, 'id'>) => {
	const id = next++;
	const doc = globalThis.document;
	const entry: Posted = { id, ...e, text: oneStop(e.text), from: doc?.activeElement === doc?.body ? null : doc.activeElement };
	band.entries = pushEntry(band.entries, entry);
	return id;
};

/** Say what changed, with how to take it back. Returns the entry, for `hold` and `release`. */
export const showToast = (text: string, undo?: Entry['undo'], subject?: string, also?: Entry['also']) => post({ text, undo, subject, also });
/** A save that failed, and how to send it again. */
export const showError = (text: string, retry?: Entry['retry']) => post({ text, error: true, retry });
/** What these are about was taken back elsewhere, such as on its row. */
export const dismissAbout = (subject: string) => (band.entries = band.entries.filter((e) => e.subject !== subject));
export const dismiss = (id: number) => (band.entries = dropEntry(band.entries, id));
/** The row shows its own way back for now, so the band doesn't. */
export const hold = (id: number) => (band.entries = setHeld(band.entries, id, true));
export const release = (id: number) => (band.entries = setHeld(band.entries, id, false));

/** Post a form action from code, as SvelteKit's enhance would. */
export async function postAction(action: string, fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return fetch(action, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
}

/** Post a form action from code and say whether it worked, with what it returned. Offline counts as not. */
export async function runAction<T = Record<string, unknown>>(
	action: string,
	fields: Record<string, string>
): Promise<{ ok: boolean; data?: T; error?: string }> {
	try {
		const r = await postAction(action, fields);
		const result = deserialize(await r.text());
		if (result.type === 'success') return { ok: true, data: result.data as T };
		const data = result.type === 'failure' ? (result.data as { error?: string } | undefined) : undefined;
		return { ok: false, error: data?.error };
	} catch {
		return { ok: false };
	}
}

/** An Undo that posts a form action. The address is whole, since the band outlives the page it came from. */
export const undoWith = (action: `/${string}`, fields: Record<string, string>) => async () => (await runAction(action, fields)).ok;
