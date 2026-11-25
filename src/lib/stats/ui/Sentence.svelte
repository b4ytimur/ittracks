<script lang="ts">
	// A card's meta line: the words that say what it shows are the controls that change it.
	import { slotsOf, type Offer, type SlotKey } from '../sentence';
	import type { StatCard } from '../model';

	let { card, offer, named, rangeWords, onpick }: { card: StatCard; offer: Offer; named: boolean; rangeWords: string; onpick: (key: SlotKey, value: string) => void } = $props();

	const what: Record<SlotKey, string> = { measure: 'What it counts', subject: 'What it is about', bucket: 'How it is grouped', range: 'Its range' };
	// An unnamed card's title is its measure, so the sentence leaves that word out.
	const slots = $derived(slotsOf(card, offer).filter((s) => s.key !== 'measure' || named || s.options.length > 1));
	const wordOf = (s: (typeof slots)[number]) => (s.key === 'range' && s.value === 'page' ? rangeWords : (s.options.find((x) => x.value === s.value)?.label ?? ''));
</script>

<p class="sentence meta">
	{#each slots as s, i (s.key)}
		{#if i}<span aria-hidden="true">·</span>{/if}
		{#if s.options.length > 1}
			<label class="word"
				><span class="vh">{what[s.key]}</span><span class="shown" aria-hidden="true">{wordOf(s)}</span><select value={s.value} onchange={(e) => onpick(s.key, e.currentTarget.value)}
					>{#each s.options as x (x.value)}<option value={x.value}>{x.label}</option>{/each}</select
				></label
			>
		{:else}<span>{wordOf(s)}</span>{/if}
	{/each}
</p>

<style>
	.sentence {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-tight);
		margin: 0;
		color: var(--ink-muted);
	}
	/* The words stand as text; the control lies over them, as wide as they are. */
	.word {
		position: relative;
		display: inline-flex;
		align-items: center;
		min-height: var(--target-min);
		max-width: 100%;
		margin: 0;
		color: inherit;
		font-size: inherit;
	}
	.shown {
		border-bottom: 1px dashed var(--line-control);
		overflow-wrap: anywhere;
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
			color: var(--ink);
		}
	}
</style>
