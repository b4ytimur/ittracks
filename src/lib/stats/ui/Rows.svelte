<script lang="ts">
	// The Table card (W7): one row per series with its total, best and last value.
	import type { CardResult } from '../engine';
	import { shortDay, value } from '../format';

	let { r, onpick }: { r: CardResult; onpick?: (series: string | null) => void } = $props();
	const fmt = (v: number | null) => value(v, r.unit, r.kind);
</script>

<div class="scroll">
	<table>
		<thead>
			<tr><th></th><th>Total</th><th>Best</th><th>Last</th><th>Logs</th></tr>
		</thead>
		<tbody>
			{#each r.rows ?? [] as x (x.key)}
				<tr>
					<th scope="row"><button type="button" class="link" onclick={() => onpick?.(x.key === 'all' ? null : x.key)}>{x.label}</button></th>
					<td>{fmt(x.total)}</td>
					<td>{fmt(x.best)}</td>
					<td>{fmt(x.last)}{#if x.lastDate}<div class="muted small">{shortDay(x.lastDate)}</div>{/if}</td>
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
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.3rem 0.4rem;
		text-align: right;
		border-bottom: 1px solid var(--grid);
		vertical-align: top;
	}
	thead th {
		color: var(--muted);
		font-weight: 500;
	}
	th[scope='row'] {
		text-align: left;
		font-weight: 500;
	}
	th[scope='row'] button {
		text-align: left;
		color: var(--text);
	}
	.small {
		font-size: 0.7rem;
	}
</style>
