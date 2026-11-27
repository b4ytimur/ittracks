<script lang="ts">
	// History's last 12 months: a column a week across the page, every day a tile. From 40rem with a fine pointer each day
	// goes to it, in one tab stop (arrows move a day up and down, a week left and right), and the line under it says the day
	// in focus or under the pointer. On a phone or a touch tablet its tiles are far under a finger's size, so it is a
	// picture: the days block and the list are the way to a day there.
	// It folds to its heading (GroupHeading's fold), and History remembers it folded.
	import { untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';
	import { addDays } from '$lib/engine/dates';
	import { saveLayout } from '$lib/viewclient';
	import { markOf, weekDays, wordsOf, yearStart, YEAR_WEEKS, type Count } from './days';

	let { today, first, counts, open: saved, href }: { today: string; first: string | null; counts: Record<string, Count>; open: boolean; href: (d: string, c: Count | undefined) => string | null } = $props();
	let open = $state(untrack(() => saved));
	function toggle() {
		const was = open;
		open = !open;
		void saveLayout({ op: 'patch', history: { year: open } }, () => (open = was));
	}
	const wide = new MediaQuery('(min-width: 40rem) and (pointer: fine)');
	/** The strip's one tab stop, and the day its line says. */
	let stop = $state(untrack(() => today));
	let shown = $state<string | null>(null);
	let grid = $state<HTMLElement>();
	function keys(e: KeyboardEvent) {
		const by = ({ ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 } as Record<string, number | undefined>)[e.key];
		if (!by) return;
		e.preventDefault();
		grid?.querySelector<HTMLElement>(`a[data-date="${addDays(stop, by)}"]`)?.focus();
	}
	const noon = (d: string) => new Date(`${d}T12:00:00`);
	const LONG = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' });
	const WD = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
	const says = (d: string) => `${LONG.format(noon(d))}: ${wordsOf(markOf(d, counts[d], today, first), counts[d])}`;
	const weeks = $derived(Array.from({ length: YEAR_WEEKS }, (_, i) => addDays(yearStart(today), 7 * i)));
</script>

<section class="year page-wide">
	<GroupHeading title="Last 12 months" folded={!open} onfold={toggle} />
	{#if open}
		<div class="year-card">
			<div class="year-months note muted" aria-hidden="true"><span></span>{#each weeks as m (m)}<span>{Number(m.slice(8)) <= 7 ? MONTH.format(noon(m)) : ''}</span>{/each}</div>
			<div
				class="year-grid"
				role={wide.current ? 'group' : 'img'}
				aria-label="The last 12 months, a column a week"
				bind:this={grid}
				onpointerleave={() => (shown = null)}
				onfocusout={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node)) shown = null;
				}}
			>
				<div class="year-col year-wd" aria-hidden="true">{#each weekDays(weeks[0]) as d, i (d)}<span>{i % 2 ? '' : WD.format(noon(d))}</span>{/each}</div>
				{#each weeks as m (m)}
					<div class="year-col">
						{#each weekDays(m) as d (d)}
							{@const c = counts[d]}
							{@const k = markOf(d, c, today, first)}
							{@const to = wide.current && k !== 'future' && k !== 'before' ? href(d, c) : null}
							{#if to}<a href={to} data-date={d} tabindex={d === stop ? 0 : -1} aria-label={says(d)} aria-current={d === today ? 'date' : undefined} onkeydown={keys} onfocus={() => ((stop = d), (shown = d))} onpointerenter={() => (shown = d)}><i data-day={k}></i></a>
							{:else}<span aria-current={d === today ? 'date' : undefined}><i data-day={k}></i></span>{/if}
						{/each}
					</div>
				{/each}
			</div>
			<p class="year-key meta muted">
				{#if shown}{says(shown)}{:else}<span><i data-day="done"></i>All done</span><span><i data-day="partial"></i>Some</span><span><i data-day="missed"></i>None done</span><span><i data-day="rest"></i>Nothing due</span>{/if}
			</p>
		</div>
	{/if}
</section>
