<script lang="ts">
	// One card on a board: its title, the range it covers, the chart, and what you can do with it.
	// Moving, resizing and removing while editing belong to the grid around it (CardGrid).
	import type { CardResult } from '../engine';
	import { rangeLabel, type StatCard } from '../model';
	import Chart from './Chart.svelte';
	import DataTable from './DataTable.svelte';

	let {
		card,
		r,
		title,
		rangeKey,
		warnings = [],
		editing = false,
		csvHref,
		onedit,
		onremove,
		ondrill,
		onheadline,
		headline = false
	}: {
		card: StatCard;
		r: CardResult;
		title: string;
		rangeKey: string;
		warnings?: string[];
		/** While the grid is in edit mode the card leaves out its menu. */
		editing?: boolean;
		csvHref?: string;
		onedit?: () => void;
		onremove?: () => void;
		ondrill?: (from: string, to: string, series: string | null) => void;
		onheadline?: () => void;
		headline?: boolean;
	} = $props();

	let table = $state(false);
	let menu = $state<HTMLDetailsElement>();
	const close = () => menu && (menu.open = false);
	const listy = $derived(['records', 'sessions', 'streak', 'table', 'goal'].includes(r.chart));
	const sub = $derived(r.chart === 'streak' ? 'Now and best' : rangeLabel(rangeKey));
</script>

<article class="card stat {card.look.size}" aria-label={title}>
	<header>
		<div class="titles">
			<h3>{title}</h3>
			<div class="muted sub">{sub}</div>
		</div>
		{#if !editing}
			<details class="card-menu" bind:this={menu}>
				<summary aria-label="More for {title}">⋯</summary>
				<div class="pop">
					{#if onedit}<button type="button" onclick={() => (close(), onedit?.())}>Edit card</button>{/if}
					{#if !listy}<button type="button" onclick={() => (close(), (table = !table))}>{table ? 'Show the chart' : 'Show as a table'}</button>{/if}
					{#if ondrill && !['streak', 'sessions', 'records'].includes(r.chart)}
						<button type="button" onclick={() => (close(), ondrill?.(r.range.from, r.range.to, null))}>Show the logs</button>
					{/if}
					{#if onheadline}<button type="button" onclick={() => (close(), onheadline?.())}>{headline ? 'Stop showing on Today' : 'Show on Today'}</button>{/if}
					{#if csvHref}<a href={csvHref} download onclick={close}>Download CSV</a>{/if}
					{#if onremove}<button type="button" class="danger" onclick={() => (close(), onremove?.())}>Remove</button>{/if}
				</div>
			</details>
		{/if}
	</header>

	{#if r.empty}
		<p class="muted empty">Nothing logged in this range yet.</p>
	{:else if table}
		<DataTable {r} />
	{:else}
		<Chart {card} {r} {rangeKey} onpick={ondrill} />
	{/if}

	{#each [...r.notes, ...warnings] as n (n)}
		<p class="muted note">{n}</p>
	{/each}

</article>

<style>
	.stat {
		display: flex;
		flex-direction: column;
		min-width: 0;
		margin: 0;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
		margin-bottom: 0.6rem;
	}
	.titles {
		min-width: 0;
	}
	h3 {
		font-size: 0.95rem;
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.sub {
		font-size: 0.75rem;
	}
	.card-menu {
		position: relative;
		flex: none;
	}
	.card-menu summary {
		list-style: none;
		cursor: pointer;
		padding: 0 0.4rem;
		border-radius: var(--radius-inset);
		color: var(--muted);
		font-size: 1.1rem;
		line-height: 1.2;
	}
	.card-menu summary::-webkit-details-marker {
		display: none;
	}
	.card-menu[open] summary {
		background: var(--grid);
	}
	.pop {
		position: absolute;
		right: 0;
		top: 1.8rem;
		z-index: var(--z-popover);
		min-width: 11rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		box-shadow: var(--shadow-popover);
		padding: 0.25rem;
		display: flex;
		flex-direction: column;
	}
	.pop button,
	.pop a {
		border: none;
		background: none;
		text-align: left;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-inset);
		font-size: 0.88rem;
		color: var(--text);
		text-decoration: none;
	}
	.pop button:hover,
	.pop a:hover {
		background: var(--grid);
	}
	.pop .danger {
		color: var(--danger);
	}
	.empty {
		font-size: 0.85rem;
		margin: 0.5rem 0;
	}
	.note {
		font-size: 0.75rem;
		margin: 0.4rem 0 0;
	}
</style>
