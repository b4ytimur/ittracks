<script lang="ts">
	// The pattern grid (W10): weekday by part of the day, darker means more.
	import type { CardResult } from '../engine';
	import { step, value } from '../format';

	let { r }: { r: CardResult } = $props();
	const g = $derived(r.grid ?? { rows: [], cols: [], values: [] });
	const max = $derived(Math.max(0, ...g.values.flat().map((v) => v ?? 0)));
</script>

<div class="scroll">
	<table>
		<thead>
			<tr><th></th>{#each g.cols as c (c)}<th scope="col">{c}</th>{/each}</tr>
		</thead>
		<tbody>
			{#each g.rows as row, i (row)}
				<tr>
					<th scope="row">{row}</th>
					{#each g.values[i] as v, j (j)}
						{@const s = step(v, max)}
						<td class="s{s}" title="{row} {g.cols[j]}: {value(v, r.unit, r.kind)}">
							{#if v}<span>{value(v, r.unit, r.kind, { short: true })}</span>{/if}
						</td>
					{/each}
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
		border-collapse: separate;
		border-spacing: 2px;
		font-size: 0.75rem;
		table-layout: fixed;
	}
	th {
		color: var(--ink-muted);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	th[scope='row'] {
		text-align: left;
		width: 2.6rem;
	}
	td {
		height: 26px;
		border-radius: 3px;
		text-align: center;
		background: var(--chart-grid);
		font-variant-numeric: tabular-nums;
	}
	td.s1 { background: var(--seq-1); }
	td.s2 { background: var(--seq-2); }
	td.s3 { background: var(--seq-3); color: var(--ink-inverse); }
	td.s4 { background: var(--seq-4); color: var(--ink-inverse); }
	td.s5 { background: var(--seq-5); color: var(--ink-inverse); }
	@media (prefers-color-scheme: dark) {
		td.s1, td.s2, td.s3 { color: var(--ink); }
		td.s4, td.s5 { color: var(--ink-inverse); }
	}
</style>
