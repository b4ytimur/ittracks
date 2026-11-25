// Saving one line of the settings: at once, with what it changed in the band, and an Undo that puts
// exactly that back.
import { invalidateAll } from '$app/navigation';
import { showToast } from '$lib/toast.svelte';
import type { SettingsSet } from '$lib/server/settings-patch';

type Renames = Record<string, string>;
type Answer = { was: SettingsSet; now: SettingsSet; renames: Renames; unitRenames: Renames; error?: string };
const back = (r: Renames = {}) => Object.fromEntries(Object.entries(r).map(([x, y]) => [y, x]));

async function send(body: object): Promise<{ status: number; r: Partial<Answer> } | null> {
	const res = await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => null);
	return res && { status: res.status, r: await res.json().catch(() => ({})) };
}

/** What saveSetting answers when nothing answered. Nothing is reloaded then: that would show an error page. */
export const NO_ANSWER = 'Not saved. Are you online?';

let queue: Promise<unknown> = Promise.resolve();

/**
 * Save it, and say so. Returns why it wasn't, or ''. One at a time: `was` is read when its turn
 * comes, so two quick changes don't look like two devices.
 */
export function saveSetting(set: SettingsSet, was: () => SettingsSet, said: string, renames: Renames = {}, unitRenames: Renames = {}): Promise<string> {
	const run = async () => {
		const a = await send({ set, was: was(), renames, unitRenames });
		if (!a) return NO_ANSWER;
		if (a.status !== 200) {
			if (a.status === 409) await invalidateAll();
			return a.r.error ?? 'Not saved.';
		}
		const { was: before, now, renames: moved, unitRenames: units } = a.r as Answer;
		if (Object.keys(now).length)
			showToast(said, async () => {
				const r = await send({ set: before, was: now, renames: back(moved), unitRenames: back(units) });
				if (r) await invalidateAll();
				return r?.status === 200 ? undefined : (r?.r.error ?? false);
			});
		await invalidateAll();
		return '';
	};
	const mine = queue.then(run, run);
	queue = mine;
	return mine;
}
