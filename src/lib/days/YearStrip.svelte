<script lang="ts">
	// History's last 12 months: a column a week across the page, every day a tile that goes to it.
	// It folds to its heading, and History remembers it folded.
	import { untrack } from 'svelte';
	import { addDays } from '$lib/engine/dates';
	import { saveLayout } from '$lib/viewclient';
	import { markOf, weekDays, wordsOf, yearStart, YEAR_WEEKS, type Count } from './days';

	let { today, first, counts, open: saved, href }: { today: string; first: string | null; counts: Record<string, Count>; open: boolean; href: (d: string, c: Count | undefined) => string | null } = $props();
	let open = $state(untrack(() => saved));
	const uid = $props.id();
	function toggle() {
		const was = open;
		open = !open;
		void saveLayout({ op: 'patch', history: { year: open } }, () => (open = was));
	}
	const noon = (d: string) => new Date(`${d}T12:00:00`);
	const LONG = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' });
	const WD = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
	const weeks = $derived(Array.from({ length: YEAR_WEEKS }, (_, i) => addDays(yearStart(today), 7 * i)));
</script>

<section class="year page-wide" aria-labelledby="{uid}-t">
	<div class="year-head">
		<button type="button" class="year-fold" aria-expanded={open} aria-controls={open ? `${uid}-b` : undefined} onclick={toggle}><span class="chev" aria-hidden="true">›</span><span id="{uid}-t">Last 12 months</span></button>
		<button type="button" class="quiet" onclick={toggle}>{open ? 'Hide' : 'Show'}</button>
	</div>
	{#if open}
		<div id="{uid}-b">
			<div class="year-months" aria-hidden="true"><span></span>{#each weeks as m (m)}<span>{Number(m.slice(8)) <= 7 ? MONTH.format(noon(m)) : ''}</span>{/each}</div>
			<div class="year-grid" role="group" aria-label="The last 12 months, a column a week">
				<div class="year-col year-wd" aria-hidden="true">{#each weekDays(weeks[0]) as d, i (d)}<span>{i % 2 ? '' : WD.format(noon(d))}</span>{/each}</div>
				{#each weeks as m (m)}
					<div class="year-col">
						{#each weekDays(m) as d (d)}
							{@const c = counts[d]}
							{@const k = markOf(d, c, today, first)}
							{@const to = k === 'future' || k === 'before' ? null : href(d, c)}
							{@const says = `${LONG.format(noon(d))}: ${wordsOf(k, c)}`}
							{#if to}<a href={to} title={says} aria-label={says} aria-current={d === today ? 'date' : undefined}><i data-heat={k}></i></a>{:else}<span title={says} aria-current={d === today ? 'date' : undefined}><i data-heat={k}></i></span>{/if}
						{/each}
					</div>
				{/each}
			</div>
			<p class="year-key meta muted"><span><i data-heat="done"></i>All done</span><span><i data-heat="partial"></i>Some</span><span><i data-heat="missed"></i>None done</span><span><i data-heat="rest"></i>Nothing due</span></p>
		</div>
	{/if}
</section>
