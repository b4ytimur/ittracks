<script lang="ts">
	// A number tile (W1): the value, the change vs the period before, and a small trend.
	import type { CardResult } from '../engine';
	import { delta, value } from '../format';

	let { r, upIsGood = true, rangeKey }: { r: CardResult; upIsGood?: boolean; rangeKey: string } = $props();

	const d = $derived(delta(r.total, r.previousTotal, r.unit, r.kind, upIsGood, rangeKey));
	// Buckets with nothing to average are gaps, not zeros: the line joins the points around them.
	const trend = $derived(r.series[0]?.values ?? []);
	const known = $derived(trend.filter((v): v is number => v !== null));
	const showTrend = $derived(known.length > 2 && known.some((v) => v !== known[0]));
	const path = $derived.by(() => {
		const max = Math.max(...known);
		const min = Math.min(...known, 0);
		const k = trend.length - 1 || 1;
		return trend
			.map((v, i) => (v === null ? null : `${(i / k) * 100},${26 - ((v - min) / (max - min || 1)) * 22}`))
			.filter(Boolean)
			.map((p, i) => `${i ? 'L' : 'M'}${p}`)
			.join('');
	});
</script>

<div class="tile">
	<div class="value">{value(r.total, r.unit, r.kind)}</div>
	{#if r.goal && r.total !== null}
		<div class="muted small">
			{r.goal.max !== null ? `Goal ${value(r.goal.min, r.unit, r.kind)} to ${value(r.goal.max, r.unit, r.kind)}` : `of ${value(r.goal.min, r.unit, r.kind)}`}
		</div>
	{/if}
	{#if d}
		<div class="delta small" class:good={d.good === true} class:bad={d.good === false}>
			{#if d.good !== null}<span aria-hidden="true">{d.text.startsWith('+') ? '▲' : '▼'}</span>{/if}
			{d.text}
		</div>
	{/if}
	{#if showTrend}
		<svg viewBox="0 0 100 28" preserveAspectRatio="none" class="spark" aria-hidden="true">
			<path d={path} vector-effect="non-scaling-stroke" />
		</svg>
	{/if}
</div>

<style>
	.value {
		font-size: 1.9rem;
		font-weight: 600;
		line-height: 1.15;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	.small {
		font-size: 0.8rem;
	}
	.delta {
		color: var(--ink);
		margin-top: 0.15rem;
	}
	.delta span {
		font-size: 0.65rem;
		margin-right: 0.15rem;
	}
	.delta.good span {
		color: var(--good);
	}
	.delta.bad span {
		color: var(--danger);
	}
	.spark {
		display: block;
		width: 100%;
		height: 28px;
		margin-top: 0.4rem;
	}
	.spark path {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.5;
		stroke-linejoin: round;
		opacity: 0.8;
	}
</style>
