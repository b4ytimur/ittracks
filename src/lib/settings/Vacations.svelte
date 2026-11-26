<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { runAction, showToast, undoWith } from '$lib/toast.svelte';

	let { vacations, today, problem = $bindable('') }: { vacations: { id: string; start: string; end: string; note: string | null }[]; today: string; problem?: string } = $props();

	const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
	const said = (v: { start: string; end: string; note: string | null }) => `${day(v.start)} to ${day(v.end)}${v.note ? `, ${v.note}` : ''}`;
	let start = $state('');
	let end = $state('');
	let note = $state('');
	let busy = $state(false);

	async function add() {
		if (busy) return;
		problem = !start || !end || end < start ? 'Pick a start and an end date, the end not before the start.' : '';
		if (problem) return;
		busy = true;
		const v = { start, end, note: note.trim() };
		const r = await runAction<{ id: string }>('/settings?/vacation', v);
		busy = false;
		if (!r.ok) return void (problem = r.error ?? 'Not saved. Are you online?');
		start = end = note = '';
		showToast(`Planned a vacation, ${said({ ...v, note: v.note || null })}.`, undoWith('/settings?/unvacation', { id: r.data!.id }));
		await invalidateAll();
	}
	async function remove(v: (typeof vacations)[number]) {
		const r = await runAction('/settings?/unvacation', { id: v.id });
		if (!r.ok) return void (problem = r.error ?? 'Not removed. Are you online?');
		problem = '';
		showToast(`Removed the vacation, ${said(v)}.`, undoWith('/settings?/vacation', { start: v.start, end: v.end, note: v.note ?? '' }));
		await invalidateAll();
	}
</script>

{#if vacations.length}
	<ul>
		{#each vacations as v (v.id)}
			<li class="act-row"><span class="status-text">{said(v)}{#if v.end < today}<span class="muted"> · over</span>{/if}</span><button type="button" class="quiet" aria-label="Remove {said(v)}" onclick={() => remove(v)}>Remove</button></li>
		{/each}
	</ul>
{/if}
<form class="l-stack" onsubmit={(e) => (e.preventDefault(), add())}>
	<div class="se-dates">
		<div class="field"><label class="label" for="vac-from">From</label><input id="vac-from" type="date" bind:value={start} onchange={() => !end && (end = start)} /></div>
		<div class="field"><label class="label" for="vac-to">To</label><input id="vac-to" type="date" bind:value={end} min={start || undefined} /></div>
	</div>
	<div class="field"><label class="label" for="vac-note">Note</label><input id="vac-note" bind:value={note} maxlength="120" placeholder="Optional" /></div>
	<div><button aria-disabled={busy}>+ Vacation</button></div>
</form>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>
