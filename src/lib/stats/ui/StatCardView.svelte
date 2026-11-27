<script lang="ts">
	// One card on a board: its title, its sentence, the chart with its point in words, and the logs
	// behind a mark. Moving belongs to the grid around it (CardGrid).
	import type { Snippet } from 'svelte';
	import type { CardResult, DrillRow, ValueKind } from '../engine';
	import { longDate, value } from '../format';
	import { CHARTS, SIZES, rangeLabel, type Chart as ChartKind, type Size, type StatCard } from '../model';
	import { chartsOf, pointOf, type Offer, type SlotKey } from '../sentence';
	import MenuButton, { type Way } from '$lib/ui/MenuButton.svelte';
	import Chart from './Chart.svelte';
	import DataTable from './DataTable.svelte';
	import Sentence from './Sentence.svelte';

	export interface Logs {
		title: string;
		rows: DrillRow[] | null;
		unit: string;
		kind: ValueKind;
	}

	let {
		card,
		r,
		title,
		rangeKey,
		boardRange,
		warnings = [],
		offer,
		csvHref,
		grip,
		logs = null,
		onpick,
		onchart,
		onsize,
		onedit,
		onremove,
		ondrill,
		onclose,
		onall,
		onheadline,
		headline = false
	}: {
		card: StatCard;
		r: CardResult | null;
		title: string;
		rangeKey: string;
		boardRange: string;
		warnings?: string[];
		/** What its words can offer; without it the card is only looked at. */
		offer?: Offer;
		csvHref?: string;
		/** The grip, from the grid: drag, arrow keys, or a tap for the Move menu. */
		grip?: Snippet;
		/** The logs behind the mark that was pressed. */
		logs?: Logs | null;
		onpick?: (key: SlotKey, value: string) => void;
		onchart?: (chart: ChartKind) => void;
		onsize?: (size: Size) => void;
		onedit?: () => void;
		onremove?: () => void;
		ondrill?: (from: string, to: string, series: string | null) => void;
		onclose?: () => void;
		onall?: () => void;
		onheadline?: () => void;
		headline?: boolean;
	} = $props();

	let table = $state(false);
	const listy = $derived(!!r && ['records', 'sessions', 'streak', 'table', 'goal'].includes(r.chart));
	const charts = $derived(offer ? chartsOf(card, offer) : []);
	const point = $derived(r ? pointOf(r) : '');
	const FEW = 5;
	const items = $derived<(Way | '-')[]>([
		...(r && !listy ? [{ label: table ? 'Show the chart' : 'Show as a table', onselect: () => (table = !table) }] : []),
		...(r && ondrill && !['streak', 'sessions', 'records'].includes(r.chart) ? [{ label: 'Show the logs', onselect: () => ondrill(r.range.from, r.range.to, null) }] : []),
		...(onheadline ? [{ label: headline ? 'Stop showing on Today' : 'Show on Today', onselect: onheadline }] : []),
		...(csvHref ? [{ label: 'Download CSV', href: csvHref, download: true }] : []),
		...(onchart && charts.length > 1 ? ['-' as const, ...charts.map((c) => ({ label: CHARTS[c], checked: c === card.look.chart, onselect: () => onchart(c) }))] : []),
		...(onsize ? ['-' as const, ...(Object.entries(SIZES) as [Size, string][]).map(([k, label]) => ({ label, checked: k === card.look.size, onselect: () => onsize(k) }))] : []),
		...(onedit || onremove ? ['-' as const] : []),
		...(onedit ? [{ label: 'All settings…', onselect: onedit }] : []),
		...(onremove ? [{ label: 'Remove', onselect: onremove }] : [])
	]);
</script>

<article class="card stat {card.look.size}" aria-label={title}>
	<header>
		{#if grip}<span class="slot">{@render grip()}</span>{/if}
		<div class="titles">
			<h3 class="card-title">{title}</h3>
			{#if offer && onpick}<Sentence {card} {offer} named={!!card.title} rangeWords={rangeLabel(boardRange).toLowerCase()} {onpick} />
			{:else}<div class="muted meta">{r?.chart === 'streak' ? 'Now and best' : rangeLabel(rangeKey)}</div>{/if}
		</div>
		{#if items.length}<span class="more"><MenuButton class="quiet glyph lg-more" label="More for {title}" {items} /></span>{/if}
	</header>

	{#if !r}
		<p class="error meta">This card could not be worked out. {warnings[0] ?? 'Change it or remove it.'}</p>
	{:else if r.empty}
		<p class="muted empty">Nothing logged in this range yet.</p>
	{:else}
		{#if point}<p class="point meta">{point}</p>{/if}
		{#if table}<DataTable {r} />{:else}<Chart {card} {r} {rangeKey} onpick={ondrill} />{/if}
	{/if}

	{#if logs}
		<section class="logs" aria-label="The logs: {logs.title}">
			<div class="logs-head"><strong class="meta">{logs.title}</strong><button type="button" class="quiet" onclick={onclose}>Close</button></div>
			{#if !logs.rows}<p class="meta muted" role="status">Finding the logs…</p>
			{:else if !logs.rows.length}<p class="meta muted">No logs here.</p>
			{:else}
				<ul>
					{#each logs.rows.slice(0, FEW) as x, i (i)}
						<li class="meta">
							{#if x.occId}<a href="/log/{x.occId}">{value(x.value, logs.unit, logs.kind)}</a>{:else}{value(x.value, logs.unit, logs.kind)}{/if}
							<span class="muted">· {longDate(x.date)} · {x.habit}{x.task && x.task !== x.habit ? ` · ${x.task}` : ''}</span>
						</li>
					{/each}
				</ul>
				{#if logs.rows.length > FEW}<button type="button" class="quiet" onclick={onall}>All {logs.rows.length}{logs.rows.length === 200 ? '+' : ''} logs</button>{/if}
			{/if}
		</section>
	{/if}

	{#each [...(r?.notes ?? []), ...(r ? warnings : [])] as n (n)}
		<p class="muted note">{n}</p>
	{/each}
</article>

<style>
	p,
	h3 {
		margin: 0;
	}
	.stat {
		position: relative;
		display: flex;
		flex-flow: column nowrap;
		align-items: stretch;
		min-width: 0;
		margin: 0;
	}
	header {
		display: flex;
		align-items: flex-start;
		gap: var(--space-inline);
		margin-bottom: var(--space-inline);
	}
	/* In the card's padding, so the grip moves nothing. */
	header > .slot {
		position: absolute;
		inset-inline-start: 0;
		width: var(--handle-slot);
		display: flex;
	}
	.titles {
		flex: 1;
		min-width: 0;
	}
	h3 {
		overflow-wrap: anywhere;
	}
	.more {
		position: relative;
		flex: none;
	}
	.point {
		margin-bottom: var(--space-inline);
	}
	.empty {
		padding: var(--space-group) 0;
	}
	.note {
		margin-top: var(--space-inline);
	}
	.logs {
		margin-top: var(--space-group);
		padding-top: var(--space-inline);
		border-top: 1px solid var(--line);
	}
	.logs-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-inline);
	}
	.logs ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.logs li {
		padding-block: var(--space-tight);
		overflow-wrap: anywhere;
	}
</style>
