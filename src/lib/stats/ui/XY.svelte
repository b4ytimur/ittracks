<script lang="ts">
	// Bars and lines over time (W2, W3), with the extras a card can ask for: stacked series,
	// a goal line or band (T7), the previous period (T6) and a rolling average (T9).
	// One bucket with several series (consistency per habit, sets per muscle) reads better
	// as labelled horizontal bars, so that case is drawn that way.
	import type { CardResult } from '../engine';
	import { niceTicks, seriesColor, tick, value } from '../format';

	let {
		r,
		chart,
		stacked = false,
		onpick
	}: { r: CardResult; chart: 'bars' | 'line'; stacked?: boolean; onpick?: (bucket: number, series: string | null) => void } = $props();

	let w = $state(320);
	let hover = $state<number | null>(null);
	const H = 180;
	const top = 10;
	const bottom = 22;

	const n = $derived(r.buckets.length);
	const horizontal = $derived(chart === 'bars' && n === 1 && r.series.length > 1);
	const values = $derived(r.series.flatMap((s) => s.values).filter((v): v is number => v !== null));
	const sums = $derived(
		stacked ? r.buckets.map((_, i) => r.series.reduce((a, s) => a + Math.max(s.values[i] ?? 0, 0), 0)) : []
	);
	const extras = $derived(
		[...(r.previous ?? []), ...(r.rolling ?? []), r.goal?.min ?? null, r.goal?.max ?? null].filter((v): v is number => v !== null)
	);
	const ticks = $derived.by(() => {
		const all = [...(stacked ? sums : values), ...extras];
		if (!all.length) return [0, 1];
		let lo = Math.min(...all);
		const hi = Math.max(...all);
		if (chart === 'bars' || horizontal) lo = Math.min(0, lo);
		else if (lo > 0 && lo < hi * 0.4) lo = 0;
		else if (lo > 0) lo = lo - (hi - lo) * 0.15;
		return niceTicks(lo, hi);
	});
	const y0 = $derived(ticks[0]);
	const y1 = $derived(ticks[ticks.length - 1]);
	const maxTick = $derived(Math.max(...ticks.map(Math.abs)));
	const left = $derived(Math.max(...ticks.map((t) => tick(t, r.unit, r.kind, maxTick).length)) * 6.5 + 8);
	const plotW = $derived(Math.max(w - left - 6, 40));
	const band = $derived(plotW / Math.max(n, 1));
	const y = (v: number) => top + (1 - (v - y0) / (y1 - y0 || 1)) * (H - top - bottom);
	const cx = (i: number) => left + band * (i + 0.5);
	const groups = $derived(stacked ? 1 : r.series.length);
	const barW = $derived(Math.max(1, Math.min(24, band / groups - 2)));

	/** A bar with a 4px rounded data end and a square base. */
	function bar(x: number, base: number, end: number, width: number, round = true): string {
		const h = Math.abs(end - base);
		const rad = round ? Math.min(4, width / 2, h) : 0;
		if (end <= base) {
			return `M${x},${base}L${x},${end + rad}Q${x},${end} ${x + rad},${end}L${x + width - rad},${end}Q${x + width},${end} ${x + width},${end + rad}L${x + width},${base}Z`;
		}
		return `M${x},${base}L${x},${end - rad}Q${x},${end} ${x + rad},${end}L${x + width - rad},${end}Q${x + width},${end} ${x + width},${end - rad}L${x + width},${base}Z`;
	}

	const linePath = (vals: (number | null)[]) =>
		vals
			.map((v, i) => (v === null ? null : `${cx(i)},${y(v)}`))
			.filter(Boolean)
			.map((p, i) => `${i ? 'L' : 'M'}${p}`)
			.join('');

	const labelEvery = $derived(Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 58)))));
	const fmt = (v: number | null) => value(v, r.unit, r.kind);

	const readout = (i: number) =>
		`${r.buckets[i]?.label ?? ''}: ${r.series.map((s) => `${r.series.length > 1 ? `${s.label || 'All'} ` : ''}${fmt(s.values[i])}`).join(', ')}`;

	function move(e: PointerEvent) {
		const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
		const i = Math.floor((e.clientX - rect.left - left) / band);
		hover = i >= 0 && i < n ? i : null;
	}
	function key(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') hover = Math.min(n - 1, (hover ?? -1) + 1);
		else if (e.key === 'ArrowLeft') hover = Math.max(0, (hover ?? n) - 1);
		else if ((e.key === 'Enter' || e.key === ' ') && hover !== null) onpick?.(hover, null);
		else return;
		e.preventDefault();
	}

	const legend = $derived([
		...(r.series.length > 1 ? r.series.map((s, i) => ({ label: s.label || 'All', color: seriesColor(i, s.key), line: chart === 'line' })) : []),
		...(r.previous ? [{ label: 'Period before', color: 'var(--muted)', line: true }] : []),
		...(r.rolling ? [{ label: 'Rolling average', color: 'var(--text)', line: true }] : [])
	]);

	// Horizontal bars: one labelled row per series.
	const hMax = $derived(Math.max(...r.series.map((s) => s.values[0] ?? 0), r.goal?.max ?? r.goal?.min ?? 0, 0));
	const hMin = $derived(Math.min(...r.series.map((s) => s.values[0] ?? 0), 0));
</script>

{#if horizontal}
	<ul class="hbars">
		{#each r.series as s (s.key)}
			{@const v = s.values[0]}
			<li>
				<button type="button" class="hrow" onclick={() => onpick?.(0, s.key)} title="Show the logs behind this">
					<span class="hlabel">{s.label || 'All'}</span>
					<span class="htrack">
						{#if r.goal}
							{@const gx = ((r.goal.min - hMin) / (hMax - hMin || 1)) * 100}
							{#if r.goal.max !== null}
								{@const gx2 = ((r.goal.max - hMin) / (hMax - hMin || 1)) * 100}
								<span class="hband" style:left="{gx}%" style:width="{gx2 - gx}%"></span>
							{:else}
								<span class="hgoal" style:left="{gx}%"></span>
							{/if}
						{/if}
						<span
							class="hfill"
							class:other={s.key === 'other'}
							style:width="{(Math.max(v ?? 0, 0) / (hMax - hMin || 1)) * 100}%"
							style:margin-left="{(-hMin / (hMax - hMin || 1)) * 100}%"
						></span>
					</span>
					<span class="hvalue">{fmt(v)}</span>
				</button>
			</li>
		{/each}
	</ul>
	{#if r.goal}
		<p class="muted note">
			{r.goal.max !== null ? `Goal: ${fmt(r.goal.min)} to ${fmt(r.goal.max)}` : `Goal: ${fmt(r.goal.min)}`}
		</p>
	{/if}
{:else}
	{#if legend.length}
		<ul class="legend" aria-label="Legend">
			{#each legend as l (l.label)}
				<li><i class:line={l.line} style:background={l.color}></i>{l.label}</li>
			{/each}
		</ul>
	{/if}
	<div class="wrap" bind:clientWidth={w}>
		<svg
			width={w}
			height={H}
			role="slider"
			aria-roledescription="chart"
			tabindex="0"
			aria-label="{chart === 'line' ? 'Line' : 'Bar'} chart. Use the arrow keys to read each value."
			aria-valuemin={0}
			aria-valuemax={Math.max(n - 1, 0)}
			aria-valuenow={hover ?? 0}
			aria-valuetext={hover !== null ? readout(hover) : 'Nothing selected'}
			onpointermove={move}
			onpointerleave={() => (hover = null)}
			onclick={() => hover !== null && onpick?.(hover, null)}
			onkeydown={key}
		>
			{#each ticks as t (t)}
				<line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} class="grid" class:zero={t === 0} />
				<text x={left - 6} y={y(t) + 4} text-anchor="end" class="axis">{tick(t, r.unit, r.kind, maxTick)}</text>
			{/each}

			{#if r.goal}
				{#if r.goal.max !== null}
					<rect x={left} width={plotW} y={y(r.goal.max)} height={Math.max(0, y(r.goal.min) - y(r.goal.max))} class="band" />
				{/if}
				<line x1={left} x2={left + plotW} y1={y(r.goal.min)} y2={y(r.goal.min)} class="goal" />
				<text x={left + plotW} y={y(r.goal.max ?? r.goal.min) - 4} text-anchor="end" class="axis">
					Goal {r.goal.max !== null ? `${fmt(r.goal.min)} to ${fmt(r.goal.max)}` : fmt(r.goal.min)}
				</text>
			{/if}

			{#if hover !== null}
				<rect x={left + band * hover} width={band} y={top} height={H - top - bottom} class="hover" />
			{/if}

			{#if chart === 'bars'}
				{#each r.series as s, si (s.key)}
					{#each s.values as v, i (i)}
						{#if v !== null && v !== 0}
							{#if stacked}
								{@const below = r.series.slice(0, si).reduce((a, x) => a + Math.max(x.values[i] ?? 0, 0), 0)}
								{@const isTop = r.series.slice(si + 1).every((x) => !(x.values[i] ?? 0))}
								{@const base = y(below)}
								{@const end = y(below + Math.max(v, 0))}
								<path
									d={bar(cx(i) - barW / 2, base - (si && below ? 1 : 0), Math.min(end + (isTop ? 0 : 1), base - 0.5), barW, isTop)}
									fill={seriesColor(si, s.key)}
								/>
							{:else}
								<path
									d={bar(cx(i) - (groups * (barW + 2) - 2) / 2 + si * (barW + 2), y(Math.max(0, y0)), y(v), barW)}
									fill={seriesColor(si, s.key)}
								/>
							{/if}
						{/if}
					{/each}
				{/each}
			{:else}
				{#each r.series as s, si (s.key)}
					<path d={linePath(s.values)} class="line" stroke={seriesColor(si, s.key)} />
					{#each s.values as v, i (i)}
						{#if v !== null && (n <= 40 || i === s.values.length - 1 || hover === i)}
							<circle cx={cx(i)} cy={y(v)} r="4" fill={seriesColor(si, s.key)} class="dot" />
						{/if}
					{/each}
				{/each}
			{/if}

			{#if r.previous}
				<path d={linePath(r.previous)} class="line previous" />
			{/if}
			{#if r.rolling}
				<path d={linePath(r.rolling)} class="line rolling" />
			{/if}

			{#each r.buckets as b, i (b.key)}
				{#if i % labelEvery === 0}
					<text x={cx(i)} y={H - 6} text-anchor="middle" class="axis">{b.label}</text>
				{/if}
			{/each}
		</svg>
		{#if hover !== null && r.buckets[hover]}
			{@const b = r.buckets[hover]}
			<div class="tip" style:left="{Math.min(Math.max(cx(hover) - 80, 0), Math.max(w - 170, 0))}px" role="status">
				<div class="muted">{b.from === b.to ? b.label : `${b.label} – ${b.to.slice(5).replace('-', '/')}`}</div>
				{#each r.series as s, si (s.key)}
					<div class="tiprow">
						<i style:background={seriesColor(si, s.key)}></i><strong>{fmt(s.values[hover])}</strong>
						{#if r.series.length > 1}<span class="muted">{s.label || 'All'}</span>{/if}
					</div>
				{/each}
				{#if stacked && r.series.length > 1}
					<div class="tiprow"><i></i><strong>{fmt(sums[hover])}</strong><span class="muted">Total</span></div>
				{/if}
				{#if r.previous}
					<div class="tiprow"><i style:background="var(--muted)"></i><strong>{fmt(r.previous[hover])}</strong><span class="muted">Period before</span></div>
				{/if}
				{#if r.rolling}
					<div class="tiprow"><i style:background="var(--text)"></i><strong>{fmt(r.rolling[hover])}</strong><span class="muted">Rolling average</span></div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.wrap {
		position: relative;
		width: 100%;
	}
	svg {
		display: block;
		overflow: visible;
		touch-action: pan-y;
		cursor: pointer;
	}
	svg:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 4px;
	}
	.grid {
		stroke: var(--grid);
		stroke-width: 1;
	}
	.grid.zero {
		stroke: var(--border);
	}
	.axis {
		fill: var(--muted);
		font-size: 11px;
	}
	.hover {
		fill: var(--text);
		opacity: 0.05;
	}
	.line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.previous {
		stroke: var(--muted);
		stroke-width: 1.5;
		opacity: 0.8;
	}
	.rolling {
		stroke: var(--text);
		opacity: 0.6;
	}
	.dot {
		stroke: var(--surface);
		stroke-width: 2;
	}
	.goal {
		stroke: var(--good);
		stroke-width: 1;
	}
	.band {
		fill: var(--good);
		opacity: 0.1;
	}
	.legend {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.8rem;
		padding: 0;
		margin: 0 0 0.4rem;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.legend i {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		margin-right: 0.3rem;
		vertical-align: -1px;
	}
	.legend i.line {
		height: 2px;
		width: 14px;
		vertical-align: 3px;
	}
	.tip {
		position: absolute;
		top: 0;
		width: 170px;
		pointer-events: none;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.4rem 0.55rem;
		font-size: 0.8rem;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
		z-index: 2;
	}
	.tiprow {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.tiprow i {
		width: 10px;
		height: 2px;
		flex: none;
	}
	.tiprow .muted {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hbars {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.hrow {
		display: grid;
		grid-template-columns: minmax(4rem, 34%) 1fr auto;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		border: none;
		background: none;
		padding: 0.2rem 0;
		text-align: left;
		font-size: 0.85rem;
	}
	.hrow:hover .htrack {
		background: var(--grid);
	}
	.hlabel {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.htrack {
		position: relative;
		height: 14px;
		border-radius: 4px;
	}
	.hfill {
		display: block;
		height: 100%;
		border-radius: 0 4px 4px 0;
		background: var(--series-1);
		min-width: 2px;
	}
	.hfill.other {
		background: var(--muted);
	}
	.hgoal {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 1px;
		background: var(--good);
	}
	.hband {
		position: absolute;
		top: -3px;
		bottom: -3px;
		background: var(--good);
		opacity: 0.12;
	}
	.hvalue {
		font-variant-numeric: tabular-nums;
		min-width: 3.5rem;
		text-align: right;
	}
	.note {
		font-size: 0.8rem;
		margin: 0.3rem 0 0;
	}
</style>
