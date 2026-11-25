<script lang="ts">
	// A routine's log: its habits are the places. One is open, the rest are a line each; only Done
	// marks one. A habit that is a whole log of its own opens that log and comes back.
	import { onMount, tick } from 'svelte';
	import { invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { runAction, showError, showToast, undoWith } from '$lib/toast.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import MenuButton, { type Way } from '$lib/ui/MenuButton.svelte';
	import type { RoutineDay } from '$lib/server/routine-day';

	let { routine: r, today, back, canLog }: { routine: RoutineDay; today: string; back: string; /** False for a day further back than Settings allow. */ canLog: boolean } = $props();
	type Step = RoutineDay['steps'][number];

	const day = $derived(r.date === today ? 'Today' : new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }));
	const open = (s: string) => s === 'due' || s === 'missed';
	const said = (s: string, level: string | null) => (s === 'done' ? `✓ Done${level === 'minimum' ? ' at Minimum' : level === 'stretch' ? ' at Stretch' : ''}` : s === 'skipped' ? 'Skipped' : s === 'missed' ? 'Missed' : 'Due');
	const words = (k: Step) => [said(k.status, k.level), k.status !== 'skipped' ? k.progress : null].filter(Boolean).join(' · ');

	/** The step you opened; without one, the first still to do. */
	let chosen = $state<string | null>(null);
	const next = $derived(r.steps.find((k) => open(k.status)) ?? null);
	const here = $derived(r.steps.find((k) => k.occurrenceId === chosen) ?? next);
	let need = $state('');
	/** One press marks one step: what was just marked keeps the act for a moment. */
	let just = $state('');

	// The band outlives this page, so its Undo has its own address.
	const url = $derived(`/log/${r.occurrenceId}` as const);
	async function act(action: 'stepDone' | 'stepSkip' | 'stepUndo', occurrence: string, text: string, keyboard = false) {
		const at = url;
		const x = await runAction<{ needsInput?: boolean; undo?: string }>(`${at}?/${action}`, { occurrence });
		if (!x.ok) {
			just = '';
			return void showError(x.error ?? 'Not saved. Are you online?');
		}
		need = x.data?.needsInput ? 'Some of them need values filled in before they count. Open those to finish.' : '';
		showToast(text, action === 'stepUndo' ? undefined : undoWith(`${at}?/stepUndo`, { occurrence, undo: x.data?.undo ?? '' }));
		chosen = null;
		await invalidateAll();
		if (keyboard) tick().then(() => document.querySelector<HTMLElement>('.lg-act, .lg-finish')?.focus());
	}
	function done(k: Step, e: MouseEvent) {
		if (just) return;
		just = k.name;
		setTimeout(() => (just = ''), 1000);
		void act('stepDone', k.occurrenceId, `Logged ${k.name}.`, e.detail === 0);
	}
	// Back from a step's own log: say what it did.
	onMount(async () => {
		const u = new URL(page.url);
		const k = r.steps.find((x) => x.occurrenceId === u.searchParams.get('did'));
		if (!k) return;
		const clear = u.searchParams.has('clear') ? '1' : '';
		u.searchParams.delete('did');
		u.searchParams.delete('clear');
		await tick(); // the router is ready
		replaceState(u, {});
		if (k.status === 'done') showToast(`Logged ${k.name}.`, undoWith(`${url}?/stepUndo`, { occurrence: k.occurrenceId, clear }));
		else showToast(`${k.name} is logged, but short of what counts, so it stays open.`);
	});
	const menuOf = (k: Step): (Way | '-')[] =>
		open(k.status)
			? [
					...(k.hasTasks ? [{ label: 'Mark it done', onselect: () => act('stepDone', k.occurrenceId, `Logged ${k.name}.`) }] : []),
					{ label: 'Skip', onselect: () => act('stepSkip', k.occurrenceId, `Skipped ${k.name}.`) },
					...(k.hasTasks ? [] : [{ label: 'Open its log', href: k.log }])
				]
			: [{ label: 'Open its log', href: k.log }];
	const all = $derived<(Way | '-')[]>(
		open(r.status)
			? [
					{ label: 'Mark the rest done', onselect: () => act('stepDone', r.occurrenceId, `Marked the rest of ${r.name} done.`) },
					{ label: 'Skip the rest', onselect: () => act('stepSkip', r.occurrenceId, `Skipped the rest of ${r.name}.`) }
				]
			: [{ label: `Open ${r.name} again`, onselect: () => act('stepUndo', r.occurrenceId, `${r.name} is open again.`) }]
	);
</script>

<svelte:head><title>{r.name} · ittracks</title></svelte:head>

<EditChrome title={r.name} modes={['use']} back={{ href: back, label: 'Back' }} hints={{ use: [day, said(r.status, r.level), r.count].filter(Boolean).join(' · ') }}>
	{#snippet actions()}{#if canLog}<span class="menu-at"><MenuButton class="hit" label="More for {r.name}" items={all} /></span>{/if}{/snippet}
</EditChrome>

{#if !canLog}
	<div class="notice"><span class="notice-text">This day is further back than Settings allow logging, so it can only be looked at.</span><span class="notice-acts"><a class="quiet hit" href="/settings#past">Change it in Settings</a></span></div>
{/if}

<ul class="elist lg-page lg-places" data-mode="use" aria-label="Habits in {r.name}">
	{#each r.steps as k (k.occurrenceId)}
		{#if k === here}
			<li class="holder lg-place" class:done={k.status === 'done'}>
				<div class="card lg-head">
					<span class="slot"></span>
					<div class="content"><h2 class="name">{k.name}</h2><p class="meta-line">{words(k)}</p></div>
					{#if canLog}<div class="verb"><MenuButton class="lg-more hit" label="More for {k.name}" items={menuOf(k)} /></div>{/if}
				</div>
				<div class="shelf lg-shelf">
					<div class="lg-slot">
						<div class="lg-open" role="group" aria-label={k.name} aria-current="step">
							{#if !canLog}
								<a class="button lg-act" href={k.log}><span class="name">Open its log</span></a>
							{:else if just}
								<button type="button" class="lg-act" aria-busy="true" aria-disabled="true"><span class="name">Logged {just}</span></button>
							{:else if !open(k.status)}
								<button type="button" class="lg-act" onclick={() => act('stepUndo', k.occurrenceId, `${k.name} is open again.`)}><span class="name">Open it again</span></button>
							{:else if k.hasTasks}
								<a class="button lg-act primary" href={k.log}><span class="name">Open its log</span></a>
							{:else}
								<button type="button" class="lg-act primary" onclick={(e) => done(k, e)}><span class="name">Done<span class="vh"> with {k.name}</span></span></button>
							{/if}
						</div>
					</div>
				</div>
			</li>
		{:else}
			<li class="holder lg-place lg-folded lg-folds" class:done={k.status === 'done'}>
				<div class="card lg-head link">
					<span class="slot"></span>
					<div class="content">
						<h2 class="name lg-fold-h">
							<button aria-expanded="false" class="lg-bare lg-fold" type="button" onclick={() => (chosen = k.occurrenceId)}
								><span aria-hidden="true" class="chev">›</span><span class="lg-fold-text"><span>{k.name}</span> <span class="meta lg-fold-words">{words(k)}</span></span></button
							>
						</h2>
					</div>
				</div>
			</li>
		{/if}
	{/each}
</ul>

<div class="lg-end">
	{#if need}<p class="notice" data-tone="warn" role="status"><span class="notice-text">{need}</span></p>{/if}
	{#if !next}<a class="button primary lg-finish" href={back}>Finish</a>{/if}
	<p class="meta muted">Each habit keeps its own log and streak. {r.name}'s day counts them.</p>
</div>

<style>
	p,
	h2 {
		margin: 0;
	}
	.menu-at {
		position: relative;
	}
	.lg-end {
		display: grid;
		gap: var(--space-group);
	}
</style>
