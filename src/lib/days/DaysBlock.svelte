<script lang="ts">
	// The days block on Today, the Day page and History: a calendar week, the last seven days, a month as tiles or the
	// last 12 months. ‹ › step it, its title picks a week or a month, ⋯ chooses what it shows and which habits count (one
	// choice, kept for every page; the band says so, with Undo). Pressing a day goes to it: `href` says where.
	import { tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { invalidateAll } from '$app/navigation';
	import MenuButton, { type Way } from '$lib/ui/MenuButton.svelte';
	import { saveLayout, viewOp } from '$lib/viewclient';
	import { showToast } from '$lib/toast.svelte';
	import { addDays, daysBetween, weekStart } from '$lib/engine/dates';
	import { addMonths, canStep, datesIn, isoWeek, markOf, monthEnd, monthStart, monthWeeks, showsNow, spanOf, stepOf, total, weekDays, wordsOf, yearStart, YEAR_WEEKS, type Count, type Show } from './days';

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
		onused,
		slotOpen = false,
		twelve = true
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
		/** A day was pressed (Today retires its hint). */
		onused?: () => void;
		/** GroupHeading's slotOpen: the rows beside it have grips, so the title keeps their name column. */
		slotOpen?: boolean;
		/** The last 12 months are offered here. History draws them across the page, so there the block shows a week. */
		twelve?: boolean;
	} = $props();

	const uid = $props.id();
	/** The saved choice: what the page loaded, or what was chosen here since, until the page loads again. */
	let show = $derived(saved);
	/** What is on screen: the saved choice, or a week where the 12 months are not offered. */
	const view = $derived<Show>(show === 'year' && !twelve ? 'week' : show);
	let lens = $derived(savedHabit);
	let at = $state(untrack(() => chosen ?? today));
	let hover = $state<string | null>(null);
	/** The live line: what is on screen after a step, a pick or the way back. */
	let said = $state('');
	let head = $state<HTMLElement>();
	// The Day page keeps the block when it goes to another day, so the block goes there too.
	$effect.pre(() => {
		const c = chosen;
		if (c) untrack(() => ((at = c), (hover = null)));
	});

	// ----- Counts: what the page loaded, and spans fetched as the block steps outside it, per habit ('' is every habit). -----
	// Seeded with what the page loaded, so the first paint (and the page without JS) has them.
	const cache = new SvelteMap<string, Record<string, Count>>([[untrack(() => savedHabit ?? ''), untrack(() => counts)]]);
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
	const letters = weekDays('2026-11-23').map((d) => WD.format(noon(d)));

	const week = $derived(weekStart(at));
	const span = $derived(spanOf(view, at, today));
	const isNow = $derived(showsNow(view, at, today, chosen));
	/** The one habit counted, named wherever the block says what it counts. */
	const lensName = $derived(habits.find((h) => h.id === lens)?.name);
	// Seven days before today are named by their dates (short enough for a phone's name column); the sub says what they are,
	// or the way back says it.
	const title = $derived(
		view === 'week' ? `Week ${isoWeek(at)}` : view === 'seven' ? (at === today ? 'Last seven days' : range(span[0], span[1])) : view === 'month' ? (at.slice(0, 4) === today.slice(0, 4) ? MONTH : MONTH_Y).format(noon(at)) : 'Last 12 months'
	);
	const sub = $derived(
		[lensName, view === 'week' ? range(week, addDays(week, 6)) + (isNow ? ' · this week' : '') : view === 'seven' ? (at === today ? range(span[0], span[1]) : isNow ? 'Seven days' : '') : view === 'month' ? at.slice(0, 4) + (isNow ? ' · this month' : '') : range(week, addDays(week, 6))].filter(Boolean).join(' · ')
	);
	const back = $derived({ week: 'This week', seven: 'Last seven days', month: 'This month', year: 'This week' }[view]);
	const foot = $derived.by(() => {
		if (hover && view === 'month') return `${LONG.format(noon(hover))} · ${wordsAt(hover)}`;
		const [f, t] = view === 'year' ? [yearStart(today), today] : span;
		const c = total(datesIn(f, t > today ? today : t), countOf);
		const weeks = Math.round(daysBetween(week, weekStart(today)) / 7), months = (Number(today.slice(0, 4)) - Number(at.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(at.slice(5, 7));
		const ago = view === 'week' && weeks ? (weeks === 1 ? 'last week' : `${weeks} weeks ago`) : view === 'month' && months ? (months === 1 ? 'last month' : `${months} months ago`) : '';
		return [c[1] ? `${c[0]} of ${c[1]} done` : 'Nothing due', view === 'month' ? pct(c) : view === 'year' ? 'in 12 months' : '', ago].filter(Boolean).join(' · ');
	});
	const heatWeeks = $derived(Array.from({ length: YEAR_WEEKS }, (_, i) => addDays(yearStart(today), 7 * i)));
	/** A week of the 12 months: its column's name, and what a step to it says. */
	const weekSays = (m: string) => ((c: Count) => `Week ${isoWeek(m)}, ${range(m, addDays(m, 6))}: ${c[1] ? `${c[0]} of ${c[1]} done` : 'nothing due'}`)(total(weekDays(m), countOf));

	// ----- Choosing: kept for every page and said in the band; its Undo puts back only what it changed -----
	const SHOWS: [Show, string, string][] = [
		['week', 'A week', 'a week'],
		['seven', 'Last seven days', 'the last seven days'],
		['month', 'A month', 'a month'],
		['year', 'Last 12 months', 'the last 12 months']
	];
	// The server changes only the field sent, so an Undo puts back its own and keeps the other as a later choice left it.
	type Field = { show: Show } | { habit: string | null };
	const patch = (days: Field) => ({ op: 'patch', today: { days } });
	async function choose(s: Show | null, h?: string | null) {
		const before = { show, lens };
		if (s) {
			show = s;
			if (s === 'seven') at = chosen ?? today;
		}
		if (h !== undefined) lens = h;
		if (show === before.show && lens === before.lens) return;
		if (!(await saveLayout(patch(s ? { show } : { habit: lens }), () => ((show = before.show), (lens = before.lens))))) return;
		// The page loads what was saved, so a block it draws again (the strip, the other column) starts from it.
		void invalidateAll();
		if (s) showToast(`The days now show ${SHOWS.find(([k]) => k === s)?.[2]}.`, () => put({ show: before.show }));
		else showToast(lensName ? `The days now count ${lensName} only.` : 'The days now count every habit.', () => put({ habit: before.lens }));
	}
	/** An Undo: its one field back (the band then loads the page again). False when it was not kept, and the band says so. */
	async function put(days: Field) {
		const was = { show, lens };
		if ('show' in days) show = days.show;
		else lens = days.habit;
		if (await viewOp(patch(days))) return true;
		show = was.show;
		lens = was.lens;
		return false;
	}
	const menu = $derived<(Way | '-')[]>([
		...SHOWS.filter(([k]) => twelve || k !== 'year').map(([k, label]) => ({ label, checked: view === k, onselect: () => void choose(k) })),
		'-',
		{ label: 'All habits', checked: lens === null, onselect: () => void choose(null, null) },
		...habits.map((h) => ({ label: h.name, checked: lens === h.id, onselect: () => void choose(null, h.id) }))
	]);

	// ----- Moving: ‹ ›, the title's picker and the way back; each says where it went -----
	function go(d: string) {
		at = d;
		hover = null;
		// Under the 12 months the title and the foot stay as they are: the week moved to is what changed.
		said = view === 'year' ? weekSays(week) : `${title}: ${foot}`;
	}
	// ponytail: the pickers list the last 12 months; ‹ › go further back.
	const pick = $derived.by<Way[]>(() => {
		if (view === 'month')
			return Array.from({ length: 12 }, (_, i) => addMonths(today, -i))
				.filter((m) => first && monthEnd(m) >= first)
				.map((m) => ({ label: MONTH_Y.format(noon(m)), value: pct(total(datesIn(m, monthEnd(m) > today ? today : monthEnd(m)), countOf)), checked: monthStart(at) === m, onselect: () => go(m) }));
		if (view === 'year') return [];
		return Array.from({ length: YEAR_WEEKS }, (_, i) => addDays(weekStart(today), -7 * i))
			.filter((m) => first && addDays(m, 6) >= first)
			.map((m) => {
				const c = total(datesIn(m, addDays(m, 6) > today ? today : addDays(m, 6)), countOf);
				return { label: `Week ${isoWeek(m)}`, value: range(m, addDays(m, 6)) + (c[1] ? ` · ${c[0]} of ${c[1]}` : ''), checked: view === 'week' && week === m, onselect: () => go(view === 'seven' ? (addDays(m, 6) > today ? today : addDays(m, 6)) : m) };
			});
	});
	const stepName = (n: -1 | 1) => ((d) => (view === 'month' ? MONTH_Y.format(noon(d)) : view === 'seven' ? `the seven days to ${DM.format(noon(d))}` : `week ${isoWeek(d)}`))(stepOf(view, at, n, today));
	const canBack = $derived(canStep(view, at, -1, today, first)), canOn = $derived(canStep(view, at, 1, today, first));
	/** aria-disabled, not disabled, so focus stays on the button at the end of the way. */
	const step = (n: -1 | 1) => (n < 0 ? canBack : canOn) && go(stepOf(view, at, n, today));
	async function toNow() {
		go(chosen && view === 'seven' ? chosen : today);
		// The way back goes with its press: focus goes to the title's picker (the first step under the 12 months).
		await tick();
		head?.querySelector<HTMLElement>('.days-pick, .days-step')?.focus();
	}
</script>

{#snippet day(d: string, inMonth = false)}
	{@const m = markAt(d)}
	{@const to = m === 'future' || m === 'before' ? null : href(d)}
	{@const says = d === chosen ? `${LONG.format(noon(d))}: ${wordsAt(d)}, the day you are on` : `${LONG.format(noon(d))}: ${wordsAt(d)}`}
	{@const current = d === chosen ? 'page' : d === today ? 'date' : undefined}
	{#if inMonth}
		{#if to}<a class="days-tile" class:chosen={d === chosen} href={to} aria-label={says} aria-current={current} onclick={onused} onpointerenter={() => (hover = d)} onfocus={() => (hover = d)}><i data-day={m}></i></a>
		{:else}<span class="days-tile" role="img" aria-label={says} aria-current={current} onpointerenter={() => (hover = d)}><i data-day={m}></i></span>{/if}
	{:else if to}<a class="day-cell" class:chosen={d === chosen} href={to} aria-label={says} aria-current={current} onclick={onused}><span class="note">{WD.format(noon(d))}</span><i data-day={m}></i><span class="note num">{Number(d.slice(8))}</span></a>
	{:else}<span class="day-cell" class:later={m === 'future' || m === 'before'} role="img" aria-label={says} aria-current={current}><span class="note">{WD.format(noon(d))}</span><i data-day={m}></i><span class="note num">{Number(d.slice(8))}</span></span>{/if}
{/snippet}

<section class="days" aria-labelledby="{uid}-h">
	<div class="days-head" class:slotted={slotOpen} bind:this={head}>
		<div class="days-name">
			<!-- Named by its title, never by the picker inside it. -->
			<h2 class="section-title days-title" id="{uid}-h" aria-label={title}>
				{#if pick.length}<MenuButton class="days-pick" label="{title}, pick a {view === 'month' ? 'month' : 'week'}" menuLabel={view === 'month' ? 'Months' : 'Weeks'} items={pick} align="start">{#snippet trigger()}{title}<span class="chev" aria-hidden="true">›</span>{/snippet}</MenuButton>{:else}{title}{/if}
			</h2>
			<p class="days-sub meta muted">{sub}{#if !isNow}{sub ? ' · ' : ''}<button type="button" class="quiet days-back" onclick={toNow}>{back}</button>{/if}</p>
		</div>
		<button type="button" class="quiet glyph days-step" aria-label="Back to {stepName(-1)}" aria-disabled={!canBack} onclick={() => step(-1)}>‹</button>
		<button type="button" class="quiet glyph days-step" aria-label="On to {stepName(1)}" aria-disabled={!canOn} onclick={() => step(1)}>›</button>
		<span class="days-more"><MenuButton class="quiet glyph" label="More on days" items={menu} /></span>
	</div>
	<div class="days-card">
		{#if view === 'year'}
			<div class="days-heat-months note muted" aria-hidden="true">{#each heatWeeks as m (m)}<span>{Number(m.slice(8)) <= 7 ? M1.format(noon(m)) : ''}</span>{/each}</div>
			<!-- A picture: ‹ › choose the week under it. -->
			<div class="days-heat" role="group" aria-label="The last 12 months, a column a week">
				{#each heatWeeks as m (m)}
					<span class="days-col" class:chosen={m === week} role="img" aria-label={weekSays(m)}>{#each weekDays(m) as d (d)}<i data-day={markAt(d)}></i>{/each}</span>
				{/each}
			</div>
		{/if}
		{#if view === 'month'}
			<div
				class="days-month"
				role="group"
				aria-label={title}
				onpointerleave={() => (hover = null)}
				onfocusout={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node)) hover = null;
				}}
			>
				{#each letters as w, i (i)}<span class="days-wd note muted">{w}</span>{/each}<span></span>
				{#each monthWeeks(at) as m (m)}
					{@const inside = weekDays(m).filter((d) => d >= monthStart(at) && d <= monthEnd(at))}
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
	<p class="days-foot meta muted">{foot}</p>
	<span class="vh" aria-live="polite">{said}</span>
</section>
