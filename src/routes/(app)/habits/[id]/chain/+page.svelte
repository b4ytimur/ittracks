<script lang="ts">
	import { weekdayNames } from '$lib/describe';

	let { data } = $props();

	type Cell = (typeof data.cells)[number]['cell'];
	const cls = (c: Cell) =>
		c.kind === 'done' ? `done ${c.level}` : c.kind === 'missed' ? (c.forgiven ? 'forgiven' : 'missed') : c.kind;
	const label = (c: Cell) =>
		c.kind === 'done'
			? `done${c.level !== 'target' ? ` at ${c.level}` : ''}`
			: c.kind === 'missed'
				? c.forgiven
					? 'missed, forgiven'
					: 'missed'
				: c.kind === 'rest'
					? 'not due'
					: c.kind;
	const columns = (n: number) => Array.from({ length: n }, (_, w) => w);
	const nice = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
	const breakLabel = (x: { kind: string; count: number }) =>
		x.kind === 'clean'
			? 'clean'
			: x.kind === 'slip' || x.kind === 'within'
				? `${x.count} slip${x.count === 1 ? '' : 's'}${x.kind === 'within' ? ', within limit' : ''}`
				: x.kind === 'before'
					? 'before you started'
					: 'still to come';
	// The first date of each week column, to label where a month starts.
	const weekDates = $derived(
		columns(data.weeks).map((w) => (data.direction === 'break' ? data.days[w * 7]?.date : data.cells[w * 7]?.date) ?? '')
	);
	/** Past days link to the day page, today to Today. */
	const hrefOf = (d: string) =>
		d > data.today || d < data.startDate || !data.canBackfill ? null : d === data.today ? '/' : `/day/${d}#h-${data.id}`;
	const monthLabel = (w: number) => {
		const d = weekDates[w];
		if (!d || (w > 0 && weekDates[w - 1].slice(0, 7) === d.slice(0, 7))) return '';
		return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short' });
	};
</script>

<svelte:head><title>{data.name} chain · ittracks</title></svelte:head>

<header class="bar">
	<div>
		<h1>{data.name}</h1>
		<div class="muted">Last {data.weeks} weeks{data.summary ? ` · ${data.summary}` : ''}</div>
	</div>
	<div class="row" style="align-items: center">
		<a href="/habits/{data.id}/stats">Stats</a>
		<a href="/habits/{data.id}">Edit</a>
		<a href="/">Back</a>
	</div>
</header>

<div class="grid" style="--weeks: {data.weeks}" role="group" aria-label="Calendar of the last {data.weeks} weeks">
	<span aria-hidden="true"></span>
	{#each columns(data.weeks) as w (w)}<span class="month muted" aria-hidden="true">{monthLabel(w)}</span>{/each}
	{#each weekdayNames as day, d (day)}
		<span class="day muted" aria-hidden="true">{d % 2 === 0 ? day : ''}</span>
		{#each columns(data.weeks) as w (w)}
			{#if data.direction === 'break'}
				{@const x = data.days[w * 7 + d]}
				{@const href = hrefOf(x.date)}
				{#if href}
					<a class="cell {x.kind}" {href} aria-label="{nice(x.date)}: {breakLabel(x)}" title="{nice(x.date)}: {breakLabel(x)}"></a>
				{:else}
					<span class="cell {x.kind}" role="img" aria-label="{nice(x.date)}: {breakLabel(x)}" title="{nice(x.date)}: {breakLabel(x)}"></span>
				{/if}
			{:else}
				{@const x = data.cells[w * 7 + d]}
				{@const href = hrefOf(x.date)}
				{#if href}
					<a class="cell {cls(x.cell)}" {href} aria-label="{nice(x.date)}: {label(x.cell)}" title="{nice(x.date)}: {label(x.cell)}"></a>
				{:else}
					<span class="cell {cls(x.cell)}" role="img" aria-label="{nice(x.date)}: {label(x.cell)}" title="{nice(x.date)}: {label(x.cell)}"></span>
				{/if}
			{/if}
		{/each}
	{/each}
</div>

{#if data.canBackfill}<p class="muted small-text tip">Tap a day to log it or change it.</p>{/if}

<div class="legend small-text">
	{#if data.direction === 'break'}
		<span><i class="cell clean"></i>Clean</span>
		{#if data.limit}<span><i class="cell within"></i>Within limit</span>{/if}
		<span><i class="cell slip"></i>Slip</span>
	{:else}
		<span><i class="cell done target"></i>Done</span>
		<span><i class="cell done minimum"></i>Minimum</span>
		<span><i class="cell done stretch"></i>Stretch</span>
		<span><i class="cell forgiven"></i>Missed, forgiven</span>
		<span><i class="cell missed"></i>Missed</span>
		<span><i class="cell skipped"></i>Skipped</span>
	{/if}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: 2.2rem repeat(var(--weeks), 1fr);
		gap: 3px;
		align-items: center;
	}
	.day,
	.month {
		font-size: 0.7rem;
	}
	.month {
		white-space: nowrap;
		overflow: visible;
	}
	h1 {
		overflow-wrap: anywhere;
	}
	.cell {
		display: inline-block;
		aspect-ratio: 1;
		width: 100%;
		max-width: 1.6rem;
		border-radius: 3px;
		background: var(--border);
		opacity: 0.5;
	}
	.cell.rest,
	.cell.before,
	.cell.future {
		opacity: 0.25;
	}
	.cell.due {
		outline: 1px dashed var(--accent);
		opacity: 1;
		background: transparent;
	}
	.cell.done,
	.cell.clean {
		background: var(--accent);
		opacity: 1;
	}
	.cell.done.minimum {
		opacity: 0.45;
	}
	.cell.done.stretch {
		box-shadow: inset 0 0 0 2px var(--text);
	}
	.cell.within {
		background: var(--accent);
		opacity: 0.45;
	}
	.cell.missed,
	.cell.slip {
		background: var(--danger);
		opacity: 1;
	}
	.cell.forgiven {
		background: transparent;
		outline: 2px solid var(--danger);
		outline-offset: -2px;
		opacity: 1;
	}
	.cell.skipped {
		background: var(--muted);
		opacity: 0.6;
	}
	a.cell:hover,
	a.cell:focus-visible {
		outline: 2px solid var(--text);
		outline-offset: 1px;
	}
	.tip {
		margin: 0.75rem 0 0;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
		margin-top: 1rem;
		color: var(--muted);
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.legend .cell {
		width: 0.9rem;
	}
	.small-text {
		font-size: 0.85rem;
	}
</style>
