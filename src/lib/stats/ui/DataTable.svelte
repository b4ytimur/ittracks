<script lang="ts">
	// Every number a chart draws, as a table: for screen readers, colorblind readers and copying.
	import type { CardResult } from '../engine';
	import { value } from '../format';

	let { r }: { r: CardResult } = $props();
	const fmt = (v: number | null | undefined) => value(v ?? null, r.unit, r.kind);
	const days = $derived((r.days ?? []).filter((d) => d.value !== null || d.status));
</script>

<div class="scroll">
	{#if r.days}
		<table>
			<thead><tr><th>Day</th><th>Value</th><th>Status</th></tr></thead>
			<tbody>
				{#each days.toReversed() as d (d.date)}
					<tr><th scope="row">{d.date}</th><td>{fmt(d.value)}</td><td>{d.status ?? ''}</td></tr>
				{/each}
			</tbody>
		</table>
	{:else if r.buckets.length}
		<table>
			<thead>
				<tr>
					<th>{r.buckets.length === 1 ? '' : 'Period'}</th>
					{#each r.series as s (s.key)}<th>{s.label || 'Value'}</th>{/each}
					{#if r.previous}<th>Period before</th>{/if}
					{#if r.rolling}<th>Rolling average</th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each r.buckets as b, i (b.key)}
					<tr>
						<th scope="row">{b.from === b.to ? b.from : `${b.from} – ${b.to}`}</th>
						{#each r.series as s (s.key)}<td>{fmt(s.values[i])}</td>{/each}
						{#if r.previous}<td>{fmt(r.previous[i])}</td>{/if}
						{#if r.rolling}<td>{fmt(r.rolling[i])}</td>{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="muted">This card is already a list.</p>
	{/if}
</div>

<style>
	.scroll {
		overflow: auto;
		max-height: 18rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.25rem 0.4rem;
		border-bottom: 1px solid var(--grid);
		text-align: right;
		white-space: nowrap;
	}
	th[scope='row'] {
		text-align: left;
		font-weight: 500;
	}
	thead th {
		color: var(--muted);
		font-weight: 500;
	}
</style>
