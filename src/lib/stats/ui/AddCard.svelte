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

	const uid = $props.id();
	let tab = $state<'suggested' | 'gallery'>(untrack(() => (suggested.length ? 'suggested' : 'gallery')));
	const groups = $derived(tab === 'suggested' ? suggested : gallery);
	const fresh = (c: StatCard) => ({ ...structuredClone(c), id: makeCard({}).id });
</script>

<section class="card add">
	<div class="bar">
		<!-- Focus comes here as it opens: the title line's New card, which opened it, steps back while it is open. -->
		<h2 tabindex="-1" {@attach (h) => h.focus()}>Add a card</h2>
		<button type="button" class="quiet" onclick={oncancel}>Close</button>
	</div>
	<!-- The other way to add, first in the body and over the tabs: a secondary, since the view's one primary is elsewhere. -->
	<button type="button" class="build" onclick={() => onbuild(makeCard({ look: { chart: 'bars', size: 'wide' }, overTime: 'sum' }))}>Build your own</button>
	<div class="subtabs">
		<div class="subtabs-row" role="tablist" aria-label="Cards to add">
			<button type="button" class="tab" role="tab" id="{uid}-suggested" aria-controls="{uid}-panel" aria-selected={tab === 'suggested'} data-reserve="From your habits" onclick={() => (tab = 'suggested')}>From your habits</button>
			<button type="button" class="tab" role="tab" id="{uid}-gallery" aria-controls="{uid}-panel" aria-selected={tab === 'gallery'} data-reserve="Gallery" onclick={() => (tab = 'gallery')}>Gallery</button>
		</div>
	</div>
	<div class="groups" role="tabpanel" id="{uid}-panel" aria-labelledby="{uid}-{tab}">
		{#each groups as g, gi (`${tab}-${gi}`)}
			<h3>{g.group}</h3>
			<ul class="list">
				{#each g.cards as c (c.id)}
					<li class="item">
						<div class="grow">
							<div>{c.title}</div>
							<div class="muted meta">{CHARTS[c.look.chart]}</div>
						</div>
						<button type="button" class="quiet" onclick={() => onbuild(fresh(c))}>Change first</button>
						<button type="button" class="quiet" onclick={() => onadd(fresh(c))}>Add</button>
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
	.build {
		margin-block-end: var(--space-group);
	}
	.groups {
		max-height: 28rem;
		overflow: auto;
	}
	h3 {
		font-size: var(--font-size-meta);
		color: var(--ink-muted);
		font-weight: 500;
		margin: var(--space-group) 0 var(--space-tight);
	}
	.item {
		display: flex;
		align-items: center;
		gap: var(--space-inline);
		padding: var(--space-inline) 0;
		border-bottom: 1px solid var(--chart-grid);
	}
	.list li + li {
		margin-top: 0;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
</style>
