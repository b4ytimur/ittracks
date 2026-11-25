// Adding a template from a page: say what was added in the band, with its Undo, and go to Habits.
import { goto } from '$app/navigation';
import { deserialize } from '$app/forms';
import { showToast } from '$lib/toast.svelte';

export interface Added {
	name: string;
	path: string;
	made: unknown;
	pack: unknown;
}
export const undoAdd = (a: Added) => async () => {
	const r = await fetch('/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ made: a.made, pack: a.pack }) }).catch(() => null);
	return r?.ok ?? false;
};
/** Returns why it wasn't added, or ''. */
export async function addFrom(url: string, body: FormData, to?: string): Promise<string> {
	try {
		const res = await fetch(url, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const r = deserialize(await res.text());
		if (r.type !== 'success') return (r.type === 'failure' && (r.data as { error?: string })?.error) || 'Not added. Nothing was changed.';
		const a = (r.data as { added: Added }).added;
		showToast(`Added ${a.name}.`, undoAdd(a));
		await goto(to ?? a.path, { invalidateAll: true });
		return '';
	} catch {
		return 'Not added. Are you online?';
	}
}
