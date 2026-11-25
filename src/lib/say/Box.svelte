<script lang="ts">
	// "What do you want to track?": said in the box, read back as a sentence whose words can be pressed.
	import { invalidateAll } from '$app/navigation';
	import { runAction, showToast, undoWith } from '$lib/toast.svelte';
	import { units } from '$lib/units-here';
	import { amountWords, daysWords, partWords, readHabit, type Days, type Said } from './read';

	let { question = 'What do you want to track?', hint = '', onstarted }: { question?: string; hint?: string; onstarted?: (habit: string) => void } = $props();

	const id = $props.id();
	let text = $state('');
	/** Words changed by hand, until something else is said. */
	let own = $state<Partial<Said>>({});
	let busy = $state(false);
	let problem = $state('');
	const read = $derived(text.trim() ? { ...readHabit(text, units()), ...own } : null);

	const DAYS: Days[] = [
		{ kind: 'every', every: 1 },
		{ kind: 'days', days: [0, 1, 2, 3, 4] },
		{ kind: 'days', days: [5, 6] },
		{ kind: 'every', every: 2 },
		...[1, 2, 3, 4, 5].map((times): Days => ({ kind: 'times', times, period: 'week' })),
		{ kind: 'times', times: 1, period: 'month' }
	];
	const PARTS: Pick<Said, 'part' | 'time'>[] = [
		{ part: null, time: null },
		{ part: 'Morning', time: null },
		{ part: 'Afternoon', time: null },
		{ part: 'Evening', time: null },
		{ part: 'Night', time: null }
	];
	const words = <T,>(list: T[], now: T, say: (x: T) => string) => (list.some((x) => say(x) === say(now)) ? list : [now, ...list]);
	const days = $derived(read ? words(DAYS, read.days, daysWords) : []);
	const parts = $derived(read ? words(PARTS, { part: read.part, time: read.time }, partWords) : []);
	const said = $derived(read ? readHabit(text, units()) : null);
	const amounts = $derived(said && said.amount !== null ? [{ amount: said.amount, unit: said.unit }, { amount: null, unit: null }] : []);

	async function start(e: SubmitEvent) {
		e.preventDefault();
		if (!read || busy) return;
		busy = true;
		problem = '';
		const r = await runAction<{ started: { habit: string; task: string | null; name: string } }>('/?/start', { said: JSON.stringify(read) });
		busy = false;
		if (!r.ok || !r.data) return void (problem = r.error ?? 'Not started. Are you online? What you wrote is still here.');
		const { habit, task, name } = r.data.started;
		text = '';
		own = {};
		showToast(`${name} is on Today.`, undoWith('/?/unstart', { habit, task: task ?? '' }));
		await invalidateAll();
		onstarted?.(habit);
	}
</script>

<form class="ob-box" onsubmit={start}>
	<div class="field">
		<label class="label" for="{id}-t">{question}</label>
		<input id="{id}-t" bind:value={text} maxlength="200" autocomplete="off" placeholder="Practise scales 10 minutes" aria-describedby="{id}-h" oninput={() => ((own = {}), (problem = ''))} />
	</div>
	{#if read}
		<p class="ob-said" id="{id}-h">
			<strong>{read.name}</strong>
			{#if read.stop}<span>· to stop. A slip is logged when it happens.</span>
			{:else}
				{#if amounts.length}
					<span aria-hidden="true">·</span>
					<label class="word"><span class="vh">How much</span><span class="shown" aria-hidden="true">{amountWords(read)}</span><select value={amountWords(read)} onchange={(e) => (own = { ...own, ...amounts.find((a) => amountWords(a) === e.currentTarget.value) })}>{#each amounts as a (amountWords(a))}<option value={amountWords(a)}>{amountWords(a)}</option>{/each}</select></label>
				{/if}
				<span aria-hidden="true">·</span>
				<label class="word"><span class="vh">How often</span><span class="shown" aria-hidden="true">{daysWords(read.days)}</span><select value={daysWords(read.days)} onchange={(e) => (own = { ...own, days: days.find((d) => daysWords(d) === e.currentTarget.value) })}>{#each days as d (daysWords(d))}<option value={daysWords(d)}>{daysWords(d)}</option>{/each}</select></label>
				<span aria-hidden="true">·</span>
				<label class="word"><span class="vh">When</span><span class="shown" aria-hidden="true">{partWords(read)}</span><select value={partWords(read)} onchange={(e) => (own = { ...own, ...parts.find((p) => partWords(p) === e.currentTarget.value) })}>{#each parts as p (partWords(p))}<option value={partWords(p)}>{partWords(p)}</option>{/each}</select></label>
			{/if}
		</p>
	{:else if hint}<p class="field-hint meta" id="{id}-h">{hint}</p>{/if}
	{#if problem}<p class="error meta" role="alert">{problem}</p>{/if}
	<div><button class="hit" class:primary={!!read} aria-disabled={busy || !read}>{busy ? 'Starting…' : 'Start tracking'}</button></div>
</form>

<style>
	p {
		margin: 0;
	}
	.ob-box {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-inline);
	}
	.ob-said {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 var(--space-tight);
		overflow-wrap: anywhere;
	}
	.word {
		position: relative;
		display: inline-flex;
		align-items: center;
		min-height: var(--target-min);
		margin: 0;
		color: inherit;
		font-size: inherit;
	}
	.shown {
		border-bottom: 1px dashed var(--line-control);
	}
	.word select {
		position: absolute;
		inset: 0;
		width: 100%;
		min-height: 0;
		margin: 0;
		padding: 0;
		opacity: 0;
		cursor: pointer;
	}
	.word:has(select:focus-visible) {
		outline: var(--focus-width) solid var(--focus-ring);
		outline-offset: var(--focus-width);
		border-radius: var(--radius-mark);
	}
	@media (hover: hover) {
		.word:hover .shown {
			border-bottom-color: var(--ink);
		}
	}
</style>
