<script lang="ts">
	// The days block on Today, the Day page and History: a calendar week, the last seven days, a month as
	// tiles or the last 12 months. ‹ › step it, its title picks a week or a month, ⋯ chooses what it shows and which
	// habits count (one choice, kept for every page). Pressing a day goes to it: `href` says where.
	import { untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import MenuButton, { type Way } from '$lib/ui/MenuButton.svelte';
	import { saveLayout } from '$lib/viewclient';
	import { addDays, daysBetween, weekStart } from '$lib/engine/dates';
	import { addMonths, canStep, datesIn, isoWeek, markOf, monthEnd, monthStart, monthWeeks, spanOf, stepOf, total, weekDays, wordsOf, yearStart, YEAR_WEEKS, type Count, type Show } from './days';

	let {
		today,
		first,
		counts,
		habits,
		show: saved,
		habit: savedHabit,
		chosen = null,
		href,
		todayCount = null,
		hint = false,
		onused,
		slotOpen = false
	}: {
		today: string;
		/** The first day anything counted was due: nothing before it. */
		first: string | null;
		/** What the page loaded, for `habit`. */
		counts: Record<string, Count>;
		habits: { id: string; name: string }[];
		show: Show;
		habit: string | null;
		/** The day the page is on (the Day page's), ringed. */
		chosen?: string | null;
		/** Where pressing a day goes; null leaves it a picture. */
		href: (d: string) => string | null;
		/** Today as the page counts it now, for every habit. */
		todayCount?: Count | null;
		/** "Press a day to go to it", until a day is pressed once. */
		hint?: boolean;
		onused?: () => void;
		/** GroupHeading's slotOpen: the rows beside it have grips, so the title keeps their name column. */
		slotOpen?: boolean;
	} = $props();

	let show = $state(untrack(() => saved));
	/** What is on screen: a week number in the month shows that week, and the choice stays the month. */
	let view = $state(untrack(() => saved));
	let lens = $state(untrack(() => savedHabit));
	let at = $state(untrack(() => chosen ?? today));
	let hover = $state<string | null>(null);

	// ----- Counts: what the page loaded, and spans fetched as the block steps outside it, per habit ('' is every habit). -----
	const cache = new SvelteMap<string, Record<string, Count>>();
	$effect(() => {
		const c = counts, h = savedHabit ?? '';
		untrack(() => cache.set(h, { ...(cache.get(h) ?? {}), ...c }));
	});
	const asked = new Set<string>();
	async function load(from: string, to: string, h: string) {
		const lo = first && from < first ? first : from, hi = to > today ? today : to;
		if (!first || lo > hi) return;
		const have = untrack(() => cache.get(h)) ?? {};
		if (datesIn(lo, hi).every((d) => have[d])) return;
		const k = `${h}:${lo}:${hi}`;
		if (asked.has(k)) return;
		asked.add(k);
		const r = await fetch(`/api/days?from=${lo}&to=${hi}${h ? `&habit=${encodeURIComponent(h)}` : ''}`).catch(() => null);
		if (!r?.ok) return void asked.delete(k);
		const got: { counts: Record<string, Count> } = await r.json();
		cache.set(h, { ...(cache.get(h) ?? {}), ...got.counts });
	}
	// The span on screen, and the last 12 months the pickers list.
	$effect(() => {
		for (const [f, t] of [spanOf(view, at, today), spanOf('year', at, today)]) void load(f, t, lens ?? '');
	});
	const known = $derived(cache.get(lens ?? '') ?? {});
	const countOf = (d: string): Count | undefined => (d === today && todayCount && !lens ? todayCount : known[d]);
	const markAt = (d: string) => markOf(d, countOf(d), today, first);
	const wordsAt = (d: string) => wordsOf(markAt(d), countOf(d));

	// ----- Words -----
	const noon = (d: string) => new Date(`${d}T12:00:00`);
	const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, o);
	const DM = fmt({ day: 'numeric', month: 'short' }), LONG = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
	const WD = fmt({ weekday: 'narrow' }), MONTH = fmt({ month: 'long' }), MONTH_Y = fmt({ month: 'long', year: 'numeric' }), M1 = fmt({ month: 'narrow' });
	const range = (a: string, b: string) => DM.formatRange(noon(a), noon(b));
	const pct = (c: Count) => (c[1] ? `${Math.round((100 * c[0]) / c[1])}%` : '');
	const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
	const letters = weekDays('2026-11-23').map((d) => WD.format(noon(d)));

	const week = $derived(weekStart(at));
	const span = $derived(spanOf(view, at, today));
	const isNow = $derived(view === show && (view === 'year' ? week === weekStart(today) : span[0] <= today && today <= span[1]));
	const title = $derived(
		view === 'week' ? `Week ${isoWeek(at)}` : view === 'seven' ? (at === today ? 'Last seven days' : `Seven days to ${DM.format(noon(at))}`) : view === 'month' ? (at.slice(0, 4) === today.slice(0, 4) ? MONTH : MONTH_Y).format(noon(at)) : 'Last 12 months'
	);
	const sub = $derived(
		view === 'week' ? range(week, addDays(week, 6)) + (isNow ? ' · this week' : '') : view === 'seven' ? range(span[0], span[1]) : view === 'month' ? at.slice(0, 4) + (isNow ? ' · this month' : '') : `Week ${isoWeek(at)} · ${range(week, addDays(week, 6))}`
	);
	const back = $derived({ week: 'This week', seven: 'Last seven days', month: 'This month', year: 'This week' }[show]);
	const foot = $derived.by(() => {
		if (hover && view === 'month') return `${LONG.format(noon(hover))} · ${wordsAt(hover)}`;
		const [f, t] = view === 'year' ? [yearStart(today), today] : span;
		const c = total(datesIn(f, t > today ? today : t), countOf);
		const weeks = Math.round(daysBetween(week, weekStart(today)) / 7), months = (Number(today.slice(0, 4)) - Number(at.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(at.slice(5, 7));
		const ago = view === 'week' && weeks ? (weeks === 1 ? 'last week' : `${weeks} weeks ago`) : view === 'month' && months ? (months === 1 ? 'last month' : `${months} months ago`) : '';
		return [c[1] ? `${c[0]} of ${c[1]} done` : 'Nothing due', view === 'month' ? pct(c) : view === 'year' ? 'in 12 months' : '', ago].filter(Boolean).join(' · ');
	});

	// ----- Choosing -----
	function choose(s: Show | null, h?: string | null) {
		const before = { show, lens };
		if (s) {
			show = view = s;
			if (s === 'seven') at = chosen ?? today;
		}
		if (h !== undefined) lens = h;
		void saveLayout({ op: 'patch', today: { days: { show, habit: lens } } }, () => ((show = view = before.show), (lens = before.lens)));
	}
	const SHOWS: [Show, string][] = [['week', 'A week'], ['seven', 'Last seven days'], ['month', 'A month'], ['year', 'Last 12 months']];
	const menu = $derived<(Way | '-')[]>([
		...SHOWS.map(([k, label]) => ({ label, checked: show === k, onselect: () => choose(k) })),
		'-',
		{ label: 'All habits', checked: lens === null, onselect: () => choose(null, null) },
		...habits.map((h) => ({ label: h.name, checked: lens === h.id, onselect: () => choose(null, h.id) }))
	]);
	// ponytail: the pickers list the last 12 months; ‹ › go further back.
	const pick = $derived.by<Way[]>(() => {
		if (view === 'month')
			return Array.from({ length: 12 }, (_, i) => addMonths(today, -i))
				.filter((m) => first && monthEnd(m) >= first)
				.map((m) => ({ label: MONTH_Y.format(noon(m)), value: pct(total(datesIn(m, monthEnd(m) > today ? today : monthEnd(m)), countOf)), checked: monthStart(at) === m, onselect: () => (at = m) }));
		if (view === 'year') return [];
		return Array.from({ length: YEAR_WEEKS }, (_, i) => addDays(weekStart(today), -7 * i))
			.filter((m) => first && addDays(m, 6) >= first)
			.map((m) => {
				const c = total(datesIn(m, addDays(m, 6) > today ? today : addDays(m, 6)), countOf);
				return { label: `Week ${isoWeek(m)}`, value: range(m, addDays(m, 6)) + (c[1] ? ` · ${c[0]} of ${c[1]}` : ''), checked: view === 'week' && week === m, onselect: () => (at = view === 'seven' ? (addDays(m, 6) > today ? today : addDays(m, 6)) : m) };
			});
	});
	const stepName = (n: -1 | 1) => ((d) => (view === 'month' ? MONTH_Y.format(noon(d)) : view === 'seven' ? `the seven days to ${DM.format(noon(d))}` : `week ${isoWeek(d)}`))(stepOf(view, at, n, today));
	function step(n: -1 | 1) {
		at = stepOf(view, at, n, today);
		hover = null;
	}
</script>

{#snippet day(d: string, inMonth = false)}
	{@const m = markAt(d)}
	{@const to = m === 'future' || m === 'before' ? null : href(d)}
	{@const says = `${LONG.format(noon(d))}: ${wordsAt(d)}`}
	{#if inMonth}
		{#if to}<a class="days-tile" class:chosen={d === chosen} href={to} title="{DM.format(noon(d))} · {wordsAt(d)}" aria-label={d === chosen ? `${says}, the day you are on` : says} aria-current={d === chosen ? 'page' : undefined} onclick={onused} onpointerenter={() => (hover = d)} onfocus={() => (hover = d)}><i data-day={m} aria-current={d === today ? 'date' : undefined}></i></a>
		{:else}<span class="days-tile" role="img" title="{DM.format(noon(d))} · {wordsAt(d)}" aria-label={says} onpointerenter={() => (hover = d)}><i data-day={m} aria-current={d === today ? 'date' : undefined}></i></span>{/if}
	{:else if to}<a class="day-cell" class:chosen={d === chosen} href={to} aria-label={d === chosen ? `${says}, the day you are on` : says} aria-current={d === chosen ? 'page' : undefined} onclick={onused}><span class="note">{WD.format(noon(d))}</span><i data-day={m} aria-current={d === today ? 'date' : undefined}></i><span class="note num">{Number(d.slice(8))}</span></a>
	{:else}<span class="day-cell" class:later={m === 'future' || m === 'before'} role="img" aria-label={says}><span class="note">{WD.format(noon(d))}</span><i data-day={m} aria-current={d === today ? 'date' : undefined}></i><span class="note num">{Number(d.slice(8))}</span></span>{/if}
{/snippet}

<section class="days" aria-label="Days">
	<div class="days-head" class:slotted={slotOpen}>
		<div class="days-name">
			<h2 class="section-title days-title">
				{#if pick.length}<MenuButton class="days-pick" label="Pick a {view === 'month' ? 'month' : 'week'}" items={pick} align="start">{#snippet trigger()}{title}<span class="chev" aria-hidden="true">›</span>{/snippet}</MenuButton>{:else}{title}{/if}
			</h2>
			<p class="days-sub meta muted">{sub}{#if !isNow} · <button type="button" class="quiet" onclick={() => ((at = chosen && show === 'seven' ? chosen : today), (view = show), (hover = null))}>{back}</button>{/if}</p>
		</div>
		<button type="button" class="days-step" aria-label="Back to {stepName(-1)}" disabled={!canStep(view, at, -1, today, first)} onclick={() => step(-1)}>‹</button>
		<button type="button" class="days-step" aria-label="On to {stepName(1)}" disabled={!canStep(view, at, 1, today, first)} onclick={() => step(1)}>›</button>
		<MenuButton class="days-step" label="What the days show" items={menu} />
	</div>
	<div class="days-card">
		{#if view === 'year'}
			<div class="days-heat-months" aria-hidden="true">{#each Array.from({ length: YEAR_WEEKS }, (_, i) => addDays(yearStart(today), 7 * i)) as m (m)}<span>{Number(m.slice(8)) <= 7 ? M1.format(noon(m)) : ''}</span>{/each}</div>
			<div class="days-heat" role="group" aria-label="The last 12 months, a column a week">
				{#each Array.from({ length: YEAR_WEEKS }, (_, i) => addDays(yearStart(today), 7 * i)) as m (m)}
					{@const c = total(weekDays(m), countOf)}
					<button type="button" class="days-col" aria-pressed={m === week} aria-label="Week {isoWeek(m)}, {range(m, addDays(m, 6))}{c[1] ? `: ${c[0]} of ${c[1]} done` : ''}" onclick={() => (at = m)}>{#each weekDays(m) as d (d)}<i data-heat={markAt(d)}></i>{/each}</button>
				{/each}
			</div>
		{/if}
		{#if view === 'month'}
			<div class="days-month" role="group" aria-label={title} onpointerleave={() => (hover = null)}>
				<span></span>{#each letters as w, i (i)}<span class="days-wd note muted">{w}</span>{/each}<span></span>
				{#each monthWeeks(at) as m (m)}
					{@const inside = weekDays(m).filter((d) => d >= monthStart(at) && d <= monthEnd(at))}
					<button type="button" class="days-wk note quiet" class:now={m === weekStart(today)} aria-label="Week {isoWeek(m)}, {range(m, addDays(m, 6))}. Show that week." onclick={() => ((view = 'week'), (at = m), (hover = null))}>W{isoWeek(m)}</button>
					{#each weekDays(m) as d (d)}{#if inside.includes(d)}{@render day(d, true)}{:else}<span></span>{/if}{/each}
					<span class="days-dates note muted num">{Number(inside[0].slice(8))}{inside.length > 1 ? `–${Number(inside[inside.length - 1].slice(8))}` : ''}</span>
				{/each}
			</div>
		{:else}
			<div class="day-week days-week" role="group" aria-label={view === 'year' ? `Week ${isoWeek(at)}` : title}>
				{#each view === 'seven' ? datesIn(span[0], span[1]) : weekDays(week) as d (d)}{@render day(d)}{/each}
			</div>
		{/if}
	</div>
	<p class="days-foot meta muted"><span>{foot}</span>{#if hint && !(hover && view === 'month')}<span>Press a day to go to it</span>{/if}</p>
</section>
