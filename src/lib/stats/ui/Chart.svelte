<script lang="ts">
	// Draws one card result as the chart it asks for.
	import type { CardResult } from '../engine';
	import type { StatCard } from '../model';
	import XY from './XY.svelte';
	import Tile from './Tile.svelte';
	import Calendar from './Calendar.svelte';
	import Goal from './Goal.svelte';
	import Records from './Records.svelte';
	import Rows from './Rows.svelte';
	import Streaks from './Streaks.svelte';
	import Breakdown from './Breakdown.svelte';
	import Pattern from './Pattern.svelte';
	import Sessions from './Sessions.svelte';

	let {
		card,
		r,
		rangeKey,
		onpick
	}: {
		card: StatCard;
		r: CardResult;
		rangeKey: string;
		/** The logs behind a number: a date range and, optionally, one series. */
		onpick?: (from: string, to: string, series: string | null) => void;
	} = $props();

	const upIsGood = $derived(card.what.source !== 'slips' && card.perLog !== 'pace');
	const pickBucket = (i: number, series: string | null) => {
		const b = r.buckets[i];
		if (b) onpick?.(b.from, b.to, series);
	};
	const pickSeries = (series: string | null) => onpick?.(r.range.from, r.range.to, series);
</script>

{#if r.chart === 'tile'}
	<Tile {r} {upIsGood} {rangeKey} />
{:else if r.chart === 'bars' || r.chart === 'line'}
	<XY {r} chart={r.chart} stacked={card.look.stacked} onpick={pickBucket} />
{:else if r.chart === 'calendar'}
	<Calendar {r} onpick={(d) => onpick?.(d, d, null)} />
{:else if r.chart === 'goal'}
	<Goal {r} onpick={pickSeries} />
{:else if r.chart === 'records'}
	<Records {r} />
{:else if r.chart === 'table'}
	<Rows {r} overTime={card.overTime} onpick={pickSeries} />
{:else if r.chart === 'streak'}
	<Streaks {r} />
{:else if r.chart === 'breakdown'}
	<Breakdown {r} onpick={pickSeries} />
{:else if r.chart === 'pattern'}
	<Pattern {r} />
{:else if r.chart === 'sessions'}
	<Sessions {r} />
{/if}
