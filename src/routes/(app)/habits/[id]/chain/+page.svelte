<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { weekdayNames } from '$lib/describe';
	import RecordTabs from '$lib/detail/RecordTabs.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';

	let { data } = $props();

	type Cell = (typeof data.cells)[number]['cell'];
	const label = (c: Cell) =>
		c.kind === 'done'
			? `done${c.level !== 'target' ? ` at ${c.level}` : ''}`
			: c.kind === 'missed'
				? c.forgiven
					? 'missed, forgiven'
					: 'missed'
				: c.kind === 'rest'
					? 'not due'
					: c.kind === 'unlogged'
						? 'not logged'
						: c.kind === 'before'
							? 'before you started'
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

	/** One day of the grid: its date, its mark, what it says and where it leads. */
	const tiles = $derived(
		(data.direction === 'break' ? data.days : data.cells).map((x) => {
			const b = 'kind' in x ? x : null;
			const c = 'cell' in x ? x.cell : null;
			const mark = b
				? b.kind
				: c!.kind === 'done'
					? c!.level === 'target'
						? 'done'
						: c!.level
					: c!.kind === 'missed' && c!.forgiven
						? 'forgiven'
						: c!.kind;
			return {
				date: x.date,
				mark: ['rest', 'before', 'future', 'ahead'].includes(mark) ? null : mark,
				says: b ? breakLabel(b) : label(c!),
				href: hrefOf(x.date)
			};
		})
	);
	/** The day being read. One press reads it, the next opens it. */
	let at = $state(untrack(() => Math.max(0, tiles.findIndex((x) => x.date === data.today))));
	let reading = $state(false);
	let grid = $state<HTMLElement>();
	function press(i: number) {
		if (reading && at === i && tiles[i].href) return void goto(tiles[i].href!);
		at = i;
		reading = true;
	}
	function keys(e: KeyboardEvent) {
		const by = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
		if (!by) return;
		e.preventDefault();
		const to = at + by;
		if (to < 0 || to >= tiles.length) return;
		at = to;
		reading = true;
		tick().then(() => grid?.querySelector<HTMLElement>(`[data-i="${to}"]`)?.focus());
	}
</script>

<svelte:head><title>{data.name} chain · ittracks</title></svelte:head>

<EditChrome title={data.name} back={{ href: '/habits', label: 'Habits' }} modes={['use']} hints={{ use: `Last ${data.weeks} weeks${data.summary ? ` · ${data.summary}` : ''}` }} />
<RecordTabs habit={data.id} at="chain" />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="grid" style="--weeks: {data.weeks}" role="group" aria-label="The last {data.weeks} weeks, a column a week" bind:this={grid} onkeydown={keys}>
	<span aria-hidden="true"></span>
	{#each columns(data.weeks) as w (w)}<span class="month muted" aria-hidden="true">{monthLabel(w)}</span>{/each}
	{#each weekdayNames as day, d (day)}
		<span class="weekday muted" aria-hidden="true">{d % 2 === 0 ? day : ''}</span>
		{#each columns(data.weeks) as w (w)}
			{@const i = w * 7 + d}
			{@const x = tiles[i]}
			<button type="button" class="cell" data-i={i} tabindex={i === at ? 0 : -1} aria-pressed={reading && i === at} aria-label="{nice(x.date)}: {x.says}" onclick={() => press(i)}>
				<i data-day={x.mark} aria-current={x.date === data.today ? 'date' : undefined}></i>
			</button>
		{/each}
	{/each}
</div>

<p class="hi-read" role="status">
	{#if reading}
		{nice(tiles[at].date)}: {tiles[at].says}.
		{#if tiles[at].href}<a href={tiles[at].href}>{'group' in data && data.group ? 'Log the habits inside it' : tiles[at].date === data.today ? 'Open Today' : 'Log or change it'}</a>{/if}
	{:else}
		<span class="muted">Press a day to read it, again to open it.</span>
	{/if}
</p>

<div class="legend">
	{#each [...(data.direction === 'break' ? [['clean', 'Clean'], ...(data.limit ? [['within', 'Within limit']] : []), ['slip', 'Slip']] : [['done', data.tracker ? 'Logged' : 'Done'], ['minimum', 'Minimum'], ['stretch', 'Stretch'], ['forgiven', 'Missed, forgiven'], ['missed', 'Missed'], ['skipped', 'Skipped'], ['unlogged', 'Not logged'], ['due', 'Due']])].filter(([k]) => tiles.some((x) => x.mark === k)) as [k, word] (k)}
		<span><i data-day={k}></i> {word}</span>
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: 2.2rem repeat(var(--weeks), minmax(0, 1fr));
		gap: 2px;
		align-items: center;
		max-width: 30rem;
	}
	.weekday,
	.month {
		font-size: var(--font-size-note);
		line-height: 1rem;
	}
	.month {
		white-space: nowrap;
		overflow: visible;
	}
	.cell {
		display: grid;
		place-items: center;
		min-height: var(--target-min);
		padding: 0;
		border: 0;
		background: none;
	}
	.cell > i {
		width: 16px;
		height: 16px;
	}
	.cell > i:not([data-day]) {
		width: 4px;
		height: 4px;
		border-radius: var(--radius-pill);
		background: var(--line);
	}
	.cell[aria-pressed='true'] {
		border-radius: var(--radius-mark);
		box-shadow: var(--chosen-shadow);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-inline) var(--space-group);
		font-size: var(--font-size-meta);
	}
</style>
