import { goto } from '$app/navigation';
import { runAction, showError, showToast } from './toast.svelte';

/** Delete what this page is about, go to `to`, and leave an Undo in the band. */
export async function deleteHere(kind: 'habit' | 'task', id: string, name: string, to: string) {
	const r = await runAction<{ deleted: { archived: boolean } }>('?/delete', {});
	if (!r.ok || !r.data) return void showError(r.error ?? `${name} is not deleted. Are you online?`);
	const { archived } = r.data.deleted;
	await goto(to, { invalidateAll: true });
	showToast(`Deleted ${name} with its logs.`, async () => {
		const back = await fetch('/api/undelete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, id, archived }) }).catch(() => null);
		return back?.ok || (back?.status === 404 ? `${name} is gone for good.` : `${name} is not back. Are you online?`);
	});
}
