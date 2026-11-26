<script lang="ts">
	// The Table card (W7): one row per series with its total, best and last value.
	import type { CardResult } from '../engine';
	import { shortDay, value } from '../format';

	let { r, overTime = 'sum', onpick }: { r: CardResult; overTime?: string; onpick?: (series: string | null) => void } = $props();
	const fmt = (v: number | null) => value(v, r.unit, r.kind);
	const HEAD: Record<string, string> = { sum: 'Total', count: 'Logs', days: 'Days', avg: 'Average', median: 'Median', min: 'Lowest', max: 'Best', last: 'Last' };
	// Skip a column that would repeat the first one.
	const showBest = $derived(overTime !== 'max');
	const showLast = $derived(overTime !== 'last');
</script>

<div class="scroll">
	<table>
		<thead>
			<tr><th></th><th>{HEAD[overTime] ?? 'Total'}</th>{#if showBest}<th>Best</th>{/if}{#if showLast}<th>Last</th>{/if}<th>Logs</th></tr>
		</thead>
		<tbody>
			{#each r.rows ?? [] as x (x.key)}
				<tr>
					<th scope="row"><button type="button" class="link" onclick={() => onpick?.(x.key === 'all' ? null : x.key)}>{x.label}</button></th>
					<td>{fmt(x.total)}</td>
					{#if showBest}<td>{fmt(x.best)}</td>{/if}
					{#if showLast}<td>{fmt(x.last)}{#if x.lastDate}<div class="muted meta">{shortDay(x.lastDate)}</div>{/if}</td>{/if}
					<td>{x.logs}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-meta);
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.3rem 0.4rem;
		text-align: right;
		border-bottom: 1px solid var(--chart-grid);
		vertical-align: top;
	}
	thead th {
		color: var(--ink-muted);
		font-weight: 500;
	}
	th[scope='row'] {
		text-align: left;
		font-weight: 500;
	}
	th[scope='row'] button {
		text-align: left;
		color: var(--ink);
	}
</style>
