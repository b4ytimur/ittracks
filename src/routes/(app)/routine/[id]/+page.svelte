<script lang="ts">
	// A routine's day: the habits inside it that are due, in order, each with its own log. Done and
	// Skip say what they did in the band, with Undo.
	import { invalidateAll } from '$app/navigation';
	import { runAction, showError, showToast, undoWith } from '$lib/toast.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import LogControl, { type Way } from '$lib/ui/LogControl.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';

	let { data } = $props();
	const r = $derived(data.routine);
	const day = $derived(r.date === data.today ? 'Today' : new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }));
	const open = (s: string) => s === 'due' || s === 'missed';
	const said = (s: string, level: string | null) => (s === 'done' ? `✓ Done${level === 'minimum' ? ' at Minimum' : level === 'stretch' ? ' at Stretch' : ''}` : s === 'skipped' ? 'Skipped' : s === 'missed' ? 'Missed' : 'Due');
	/** What to do next: the first still open. */
	const next = $derived(data.kids.find((k) => open(k.status)) ?? null);
	let need = $state('');

	const url = $derived(`/routine/${r.occurrenceId}` as const);
	async function act(action: 'done' | 'skip' | 'undo', occurrence: string, text: string) {
		const x = await runAction<{ needsInput?: boolean }>(`${url}?/${action}`, { occurrence });
		if (!x.ok) return void showError(x.error ?? 'Not saved. Are you online?');
		need = x.data?.needsInput ? 'Some of them need values filled in before they count. Open those to finish.' : '';
		showToast(text, action === 'undo' ? undefined : undoWith(`${url}?/undo`, { occurrence }));
		await invalidateAll();
	}
	const waysOf = (k: (typeof data.kids)[number]): { act: Way; ways: (Way | '-')[] } => {
		if (!open(k.status)) return { act: { label: 'Undo', onselect: () => act('undo', k.occurrenceId, `${k.name} is open again.`) }, ways: k.hasTasks ? [{ label: 'Open its log', href: k.log }] : [] };
		const skip: Way = { label: 'Skip', onselect: () => act('skip', k.occurrenceId, `Skipped ${k.name}.`) };
		return k.hasTasks
			? { act: { label: 'Log', href: k.log }, ways: [{ label: 'Mark it done', onselect: () => act('done', k.occurrenceId, `Logged ${k.name}.`) }, skip] }
			: { act: { label: 'Done', onselect: () => act('done', k.occurrenceId, `Logged ${k.name}.`) }, ways: [skip, { label: 'Open its log', href: k.log }] };
	};
	const all = $derived<(Way | '-')[]>(
		open(r.status)
			? [
					{ label: 'Mark the rest done', onselect: () => act('done', r.occurrenceId, `Marked the rest of ${r.name} done.`) },
					{ label: 'Skip the rest', onselect: () => act('skip', r.occurrenceId, `Skipped the rest of ${r.name}.`) }
				]
			: [{ label: `Open ${r.name} again`, onselect: () => act('undo', r.occurrenceId, `${r.name} is open again.`) }]
	);
</script>

<svelte:head><title>{r.name} · ittracks</title></svelte:head>

<EditChrome title={r.name} modes={['use']} back={{ href: r.date === data.today ? '/' : `/day/${r.date}`, label: r.date === data.today ? 'Today' : 'The day' }} hints={{ use: [day, said(r.status, r.level), r.count].filter(Boolean).join(' · ') }}>
	{#snippet actions()}<span class="more"><MenuButton class="hit" label="More for {r.name}" items={all} /></span>{/snippet}
</EditChrome>

<ol class="elist" style="--gap: var(--space-inline)">
	{#each data.kids as k (k.occurrenceId)}
		{@const w = waysOf(k)}
		<li class="row">
			<div class="card" class:done={k.status === 'done'}>
				<div class="content">
					<span class="name">{k.name}{#if k === next}&nbsp;<span class="tag strong">Next</span>{/if}</span>
					<p class="meta-line meta">{[said(k.status, k.level), k.status !== 'skipped' ? k.progress : null].filter(Boolean).join(' · ')}</p>
				</div>
				<span class="verb"><LogControl name={k.name} act={w.act} ways={w.ways} primary={k === next} /></span>
			</div>
		</li>
	{/each}
</ol>
{#if need}<p class="notice" data-tone="warn" role="status"><span class="notice-text">{need}</span></p>{/if}
<p class="meta muted">Each habit keeps its own log and streak. {r.name}'s day counts them.</p>

<style>
	ol {
		list-style: none;
		margin: var(--space-group) 0;
		padding: 0;
	}
	.more {
		position: relative;
	}
</style>
