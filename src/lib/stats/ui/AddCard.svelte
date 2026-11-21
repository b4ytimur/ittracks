<script lang="ts">
	// Adding a card: cards made from your own habits, a gallery of common questions, or your own.
	import { untrack } from 'svelte';
	import { CHARTS, makeCard, type StatCard } from '../model';

	let {
		suggested,
		gallery,
		onadd,
		onbuild,
		oncancel
	}: {
		suggested: { group: string; cards: StatCard[] }[];
		gallery: { group: string; cards: StatCard[] }[];
		onadd: (card: StatCard) => void;
		onbuild: (card: StatCard) => void;
		oncancel: () => void;
	} = $props();

	let tab = $state<'suggested' | 'gallery'>(untrack(() => (suggested.length ? 'suggested' : 'gallery')));
	const groups = $derived(tab === 'suggested' ? suggested : gallery);
	const fresh = (c: StatCard) => ({ ...structuredClone(c), id: makeCard({}).id });
</script>

<section class="card add">
	<div class="bar">
		<h2>Add a card</h2>
		<button type="button" class="small" onclick={oncancel}>Close</button>
	</div>
	<div class="tabs-row" role="tablist">
		<button type="button" role="tab" aria-selected={tab === 'suggested'} class:on={tab === 'suggested'} onclick={() => (tab = 'suggested')}>From your habits</button>
		<button type="button" role="tab" aria-selected={tab === 'gallery'} class:on={tab === 'gallery'} onclick={() => (tab = 'gallery')}>Gallery</button>
		<button type="button" class="primary small" onclick={() => onbuild(makeCard({ look: { chart: 'bars', size: 'wide' }, overTime: 'sum' }))}>Build your own</button>
	</div>
	<div class="groups">
		{#each groups as g (g.group)}
			<h3>{g.group}</h3>
			<ul class="list">
				{#each g.cards as c (c.id)}
					<li class="item">
						<div class="grow">
							<div>{c.title}</div>
							<div class="muted small">{CHARTS[c.look.chart]}</div>
						</div>
						<button type="button" class="small link" onclick={() => onbuild(fresh(c))}>Change first</button>
						<button type="button" class="small" onclick={() => onadd(fresh(c))}>Add</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">Add a habit with fields you log, and cards made from it show up here.</p>
		{/each}
	</div>
</section>

<style>
	.add h2 {
		margin: 0;
	}
	.tabs-row {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.tabs-row [role='tab'] {
		border-radius: 999px;
		padding: 0.25rem 0.75rem;
		font-size: 0.88rem;
	}
	.tabs-row [role='tab'].on {
		border-color: var(--accent);
		color: var(--accent);
	}
	.tabs-row .primary {
		margin-left: auto;
	}
	.groups {
		max-height: 28rem;
		overflow: auto;
	}
	h3 {
		font-size: 0.85rem;
		color: var(--muted);
		font-weight: 500;
		margin: 0.8rem 0 0.3rem;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--grid);
	}
	.list li + li {
		margin-top: 0;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.small {
		font-size: 0.8rem;
	}
</style>
