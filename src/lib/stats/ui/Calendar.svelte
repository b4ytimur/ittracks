<script lang="ts">
	// A calendar of days (W4): darker means more. For one habit, missed days are marked too.
	import type { CardResult } from '../engine';
	import { longDate, step, value } from '../format';
	import { weekday } from '$lib/engine/dates';

	let { r, onpick }: { r: CardResult; onpick?: (date: string) => void } = $props();

	let w = $state(320);
	let hover = $state<{ date: string; v: number | null; status: string | null; x: number; y: number } | null>(null);
	const days = $derived(r.days ?? []);
	const lead = $derived(days.length ? weekday(days[0].date) : 0);
	const weeks = $derived(Math.ceil((lead + days.length) / 7));
	const cell = $derived(Math.max(6, Math.min(16, Math.floor((w - 24) / Math.max(weeks, 1)) - 2)));
	const max = $derived(Math.max(0, ...days.map((d) => d.value ?? 0)));
	const ROWS = ['M', '', 'W', '', 'F', '', ''];
	const months = $derived(
		days
			.map((d, i) => ({ d, i }))
			.filter(({ d, i }) => d.date.endsWith('-01') || i === 0)
			.map(({ d, i }) => ({ col: Math.floor((lead + i) / 7), label: new Date(d.date + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }) }))
			.filter((m, i, all) => i === 0 || m.col - all[i - 1].col >= 3)
	);
</script>

<div class="cal" bind:clientWidth={w}>
	<svg width={22 + weeks * (cell + 2)} height={16 + 7 * (cell + 2)} role="img" aria-label="Calendar of {days.length} days">
		{#each months as m (m.col)}
			<text x={22 + m.col * (cell + 2)} y="10" class="axis">{m.label}</text>
		{/each}
		{#each ROWS as l, i (i)}
			{#if l}<text x="0" y={16 + i * (cell + 2) + cell - 1} class="axis">{l}</text>{/if}
		{/each}
		{#each days as d, i (d.date)}
			{@const col = Math.floor((lead + i) / 7)}
			{@const row = (lead + i) % 7}
			{@const s = step(d.value, max)}
			<rect
				x={22 + col * (cell + 2)}
				y={16 + row * (cell + 2)}
				width={cell}
				height={cell}
				rx="2"
				class="c s{s}"
				class:missed={d.status === 'missed' && !s}
				class:future={d.status === 'future'}
				role="button"
				tabindex="-1"
				aria-label="{longDate(d.date)}: {value(d.value, r.unit, r.kind)}{d.status ? `, ${d.status}` : ''}"
				onpointerenter={() => (hover = { date: d.date, v: d.value, status: d.status, x: 22 + col * (cell + 2), y: 16 + row * (cell + 2) })}
				onpointerleave={() => (hover = null)}
				onclick={() => onpick?.(d.date)}
				onkeydown={(e) => e.key === 'Enter' && onpick?.(d.date)}
			/>
		{/each}
	</svg>
	{#if hover}
		<div class="tip" style:left="{Math.min(hover.x, Math.max(w - 170, 0))}px" style:top="{hover.y + cell + 4}px" role="status">
			<strong>{value(hover.v, r.unit, r.kind)}</strong>
			<div class="muted">{longDate(hover.date)}{hover.status && hover.status !== 'done' ? ` · ${hover.status}` : ''}</div>
		</div>
	{/if}
	<div class="key muted" aria-hidden="true">
		Less {#each [0, 1, 2, 3, 4, 5] as s (s)}<i class="c s{s}"></i>{/each} More
		{#if days.some((d) => d.status === 'missed')}<span><i class="c missed"></i> Missed</span>{/if}
	</div>
</div>

<style>
	.cal {
		position: relative;
		overflow-x: auto;
	}
	svg {
		display: block;
	}
	.axis {
		fill: var(--muted);
		font-size: 10px;
	}
	.c {
		fill: var(--grid);
		background: var(--grid);
		cursor: pointer;
	}
	.c.s1 { fill: var(--seq-1); background: var(--seq-1); }
	.c.s2 { fill: var(--seq-2); background: var(--seq-2); }
	.c.s3 { fill: var(--seq-3); background: var(--seq-3); }
	.c.s4 { fill: var(--seq-4); background: var(--seq-4); }
	.c.s5 { fill: var(--seq-5); background: var(--seq-5); }
	.c.missed {
		fill: transparent;
		stroke: var(--danger);
		stroke-width: 1.5;
		background: transparent;
		box-shadow: inset 0 0 0 1.5px var(--danger);
	}
	.c.future {
		fill: transparent;
		stroke: var(--grid);
	}
	.c:hover {
		stroke: var(--text);
		stroke-width: 1;
	}
	.key {
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 0.75rem;
		margin-top: 0.3rem;
	}
	.key i {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.key span {
		margin-left: 0.6rem;
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.tip {
		position: absolute;
		pointer-events: none;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		padding: 0.35rem 0.5rem;
		font-size: 0.8rem;
		box-shadow: var(--shadow-tooltip);
		z-index: var(--z-raised);
		white-space: nowrap;
	}
</style>
