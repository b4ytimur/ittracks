<script lang="ts">
	// A breakdown (W9): one whole split into parts, as a segmented bar with a labelled list.
	import type { CardResult } from '../engine';
	import { seriesColor, value } from '../format';

	let { r, onpick }: { r: CardResult; onpick?: (series: string | null) => void } = $props();
	const parts = $derived(r.breakdown ?? []);
</script>

<div class="seg" aria-hidden="true">
	{#each parts as p, i (p.key)}
		{#if p.share > 0}<span style:flex-grow={p.share} style:background={seriesColor(i, p.key)}></span>{/if}
	{/each}
</div>
<ul class="parts">
	{#each parts as p, i (p.key)}
		<li>
			<button type="button" onclick={() => onpick?.(p.key === 'other' ? null : p.key)}>
				<i style:background={seriesColor(i, p.key)}></i>
				<span class="label">{p.label || 'All'}</span>
				<strong>{value(p.value, r.unit, r.kind)}</strong>
				<span class="muted share">{Math.round(p.share * 100)}%</span>
			</button>
		</li>
	{/each}
</ul>

<style>
	.seg {
		display: flex;
		gap: 2px;
		height: 14px;
		margin-bottom: 0.5rem;
	}
	.seg span {
		flex-basis: 0;
		min-width: 3px;
	}
	.seg span:first-child {
		border-radius: 4px 0 0 4px;
	}
	.seg span:last-child {
		border-radius: 0 4px 4px 0;
	}
	.seg span:only-child {
		border-radius: 4px;
	}
	.parts {
		list-style: none;
		padding: 0;
		margin: 0;
		font-size: var(--font-size-meta);
	}
	button {
		display: grid;
		grid-template-columns: 10px 1fr auto 3rem;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		border: none;
		background: none;
		padding: 0.2rem 0;
		text-align: left;
	}
	/* The lines touch, so Button's grown touch area would take the next line's taps: each line is its own target. */
	button::before {
		content: none;
	}
	i {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.share {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
