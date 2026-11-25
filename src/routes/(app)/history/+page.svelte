<script lang="ts">
	// What happened, a day at a time, newest first. The Journal is this page with notes only.
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import ViewBar from '$lib/ViewBar.svelte';
	import EditableList from '$lib/ui/EditableList.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import type { Mode } from '$lib/ui/list';
	import BulkBar from '$lib/bulk/BulkBar.svelte';
	import DayNote from '$lib/DayNote.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import { dayCount, dayMark, dayTitle, placeNotes, type DayLog } from '$lib/history/day';
	import { dayExcerpt } from '$lib/journal';
	import { STATUSES } from '$lib/views';
	import { saveLayout } from '$lib/viewclient';

	let { data } = $props();

	let views = $state(untrack(() => data.views));
	let view = $state(untrack(() => data.initial));
	let mode = $state<Mode>('use');
	const selected = new SvelteSet<string>();
	let outcome = $state(new Map<string, { tag?: string; reason?: string }>());
	let q = $derived(data.q);

	type Occ = (typeof data.history)[number][1]['occurrences'][number];
	type Note = (typeof data.notes)[string]['items'][number];
	const title = (d: string) => dayTitle(d, data.today);
	const levelName = { minimum: 'Minimum', target: 'Target', stretch: 'Stretch' } as const;

	const fits = (x: { habitId: string; areaId: string | null }) =>
		(!view.habit || x.habitId === view.habit) && (!view.areas.length || view.areas.includes(x.areaId ?? ''));
	const filtering = $derived(!!view.habit || view.areas.length > 0 || view.status !== 'all');
	/** Days with only what passes the filters; empty days drop out. */
	const days = $derived.by(() => {
		const out = data.history
			.map(([date, day]) => {
				const w = data.notes[date];
				// With notes only, the rows that have one.
				const wrote = (kind: 'slip' | null) => (x: { habitId: string }) => !data.notesOnly || (w?.items ?? []).some((i) => i.habitId === x.habitId && (i.kind === 'slip') === (kind === 'slip'));
				const status = data.notesOnly ? 'all' : view.status;
				const occurrences = status === 'slip' ? [] : day.occurrences.filter((o) => fits(o) && wrote(null)(o) && (status === 'all' || o.status === status));
				const slips = status === 'all' || status === 'slip' ? day.slips.filter((s) => fits(s) && wrote('slip')(s)) : [];
				// A note belongs to its habit; the day's own note shows while nothing is filtered.
				const shows = (i: { habitId: string | null }) => [...occurrences, ...slips].some((x) => x.habitId === i.habitId);
				const items = (w?.items ?? []).filter((i) => (view.habit ? i.habitId === view.habit : view.areas.length || status !== 'all' ? shows(i) : true));
				return { date, occurrences, slips, items, notes: placeNotes(items, occurrences, slips), moods: data.notesOnly ? (w?.moods ?? []) : [], count: dayCount(countedOn(date, day.occurrences)) };
			})
			.filter((d) => d.occurrences.length || d.slips.length || d.items.length || d.moods.length);
		return view.sort === 'oldest' ? out.reverse() : out;
	});
	/** A day's logs as its count sees them: today's also holds what is still to do. */
	const countedOn = <T extends DayLog>(date: string, logs: T[]): DayLog[] => (date === data.today ? [...logs, ...data.openToday] : logs);
	const logsOf = $derived(new Map(data.history.map(([date, d]) => [date, countedOn(date, d.occurrences)])));
	const yesterday = $derived(dayCount(logsOf.get(data.strip[5]) ?? []));
	const withLogs = $derived(data.history.filter(([, d]) => d.occurrences.some((o) => o.status === 'done')).length);

	function words(o: Occ): string {
		const done = o.status === 'done' ? `Done${o.levels?.enabled ? ` at ${levelName[o.level ?? 'target']}` : ''}` : o.status === 'skipped' ? 'Skipped' : 'Missed';
		const values = views.history.values ? (data.values[o.id] ?? []).join(' · ') : data.entryCounts[o.id] ? `${data.entryCounts[o.id]} ${data.entryCounts[o.id] === 1 ? 'entry' : 'entries'}` : '';
		return [done, o.variant, data.partial[o.id] || null, values].filter(Boolean).join(' · ');
	}
	const hrefOf = (o: Occ, date: string) => (o.status === 'done' ? `/log/${o.id}` : `/day/${date}`);

	function toggleValues() {
		const before = views.history;
		views.history = { ...views.history, values: !views.history.values };
		saveLayout({ op: 'patch', history: { values: views.history.values } }, () => (views.history = before), toggleValues);
	}
	/** The address for these filters; browsing keeps how far back it goes. */
	function at(o: { q?: string; notes?: boolean; mood?: string; days?: number }) {
		const p = new URLSearchParams();
		if (o.notes ?? data.notesOnly) p.set('notes', '');
		if (o.q ?? data.q) p.set('q', o.q ?? data.q);
		if (o.mood ?? data.mood) p.set('mood', o.mood ?? data.mood);
		if (o.days) p.set('days', String(o.days));
		const s = p.toString().replace(/notes=(&|$)/, 'notes$1');
		return `/history${s ? `?${s}` : ''}`;
	}
	const find = (e: Event) => {
		e.preventDefault();
		goto(at({ q: q.trim() }), { keepFocus: true, noScroll: true });
	};
	let openNotes = $state<Record<string, boolean>>({});
	/** Long enough to fold: more than about four lines. */
	const long = (text: string) => text.length > 280 || text.split('\n').length > 5;
	let setupProblem = $state('');
</script>

<svelte:head><title>{data.notesOnly ? 'Journal' : 'History'} · ittracks</title></svelte:head>

<EditChrome
	title="History"
	{mode}
	modes={data.notesOnly ? ['use'] : ['use', 'select']}
	onmode={(m) => (mode = m)}
	hints={{
		use: data.notesOnly
			? `${days.length} ${days.length === 1 ? 'day' : 'days'} with something written`
			: [`${withLogs} ${withLogs === 1 ? 'day' : 'days'} with logs`, yesterday.of ? `${yesterday.done} of ${yesterday.of} done yesterday` : ''].filter(Boolean).join(' · '),
		select: 'Tick days to change them together.'
	}}
>
	{#snippet actions()}
		{#if data.canBackfill}<a class="button" href="/day">Log a past day</a>{/if}
		<span class="menu-at">
			<MenuButton
				class="hit"
				label="More for History"
				items={[
					{ label: views.history.values ? 'Hide what a log holds' : 'Show what a log holds', onselect: toggleValues },
					...(data.journal ? [{ label: 'Export the journal', href: '/journal/export' }] : [])
				]}
			/>
		</span>
	{/snippet}
</EditChrome>

{#if !data.notesOnly && !data.q}
	<div class="day-week hi-strip" role="group" aria-label="The last seven days">
		{#each data.strip as d (d)}
			{@const logs = logsOf.get(d) ?? (d === data.today ? data.openToday : [])}
			{@const c = dayCount(logs)}
			{@const mark = dayMark(logs, d === data.today)}
			<a class="day-cell" href={logsOf.has(d) ? `#d-${d}` : d === data.today ? '/' : `/day/${d}`} aria-current={d === data.today ? 'date' : undefined} aria-label="{title(d)}: {c.of ? `${c.done} of ${c.of} done` : 'nothing due'}">
				<span class="note">{new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
				<i data-day={mark === 'none' ? null : mark}></i>
				<span class="note num">{Number(d.slice(8))}</span>
			</a>
		{/each}
	</div>
{/if}

<form class="row find" role="search" onsubmit={find}>
	<input class="grow" type="search" bind:value={q} placeholder={data.notesOnly ? 'Words in any entry' : 'Search habits and notes'} aria-label="Search" />
	{#if data.journal}<button type="button" class="toggle" aria-pressed={data.notesOnly} onclick={() => goto(at({ notes: !data.notesOnly, mood: '' }), { noScroll: true })}>Notes only</button>{/if}
	{#if data.q || data.mood}<button type="button" class="link" onclick={() => goto(data.notesOnly ? '/history?notes' : '/history')}>Clear</button>{/if}
</form>
{#if data.notesOnly && data.moods.length}
	<div class="chips" role="group" aria-label="Mood">
		{#each data.moods as m (m)}<button type="button" class="toggle" aria-pressed={data.mood === m} onclick={() => goto(at({ mood: data.mood === m ? '' : m }) === '/history?notes' ? '/history?notes' : data.mood === m ? `/history?notes${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}` : at({ mood: m }), { noScroll: true })}>{m}</button>{/each}
	</div>
{/if}
{#if !data.notesOnly && data.history.length}
	<ViewBar page="history" bind:views bind:current={view} areas={data.areas} habits={data.habits} statuses={STATUSES} />
{/if}

{#if mode === 'select'}
	<BulkBar kind="day" {selected} bind:outcome visible={days.flatMap((d) => d.occurrences.map((o) => o.id))} today={data.today} />
{/if}

{#if data.ready}
	<p class="notice" role="status"><span class="notice-text">{data.ready.includes('habit') ? 'Added the Journal habit to Today. ' : ''}{data.ready.includes('note') ? 'The day note is on Today now. ' : ''}</span><span class="notice-acts"><a class="quiet hit" href="/settings#daynote">Change in Settings</a></span></p>
{/if}
{#if data.setup}
	<form method="POST" action="/journal?/setup" class="card stack" use:enhance={() => async ({ result, update }) => {
		setupProblem = result.type === 'failure' ? String(result.data?.error ?? 'Not set up.') : '';
		await update({ reset: false });
	}}>
		<h2 class="card-title">Do you want a daily journal?</h2>
		<p class="meta">Your journal is private: it never goes into templates or anything you share. Both can be changed later.</p>
		<label class="check"><input type="checkbox" class="pick" name="habit" checked={!data.setup.hasJournal} disabled={data.setup.hasJournal} /> A Journal habit: a few lines each evening with a daily prompt, and a mood you can chart{data.setup.hasJournal ? ' (you have one)' : ''}</label>
		<label class="check"><input type="checkbox" class="pick" name="dayNote" checked={!data.setup.dayNote} disabled={data.setup.dayNote} /> A day note on Today: one free note per day, no streak{data.setup.dayNote ? ' (it is on)' : ''}</label>
		{#if setupProblem}<p class="error meta" role="alert">{setupProblem}</p>{/if}
		<div class="l-cluster"><button class="primary">Set up</button><a class="button" href="/history?notes">Not now</a></div>
	</form>
{/if}
{#if data.dayNote !== null && !data.q && !data.mood}<div class="hi-daynote"><DayNote date={data.today} text={data.dayNote} link={false} /></div>{/if}
{#if data.lookBack.length}
	<GroupHeading title="On this day" />
	<ul class="elist" data-mode="use" aria-label="On this day">
		{#each data.lookBack as x (x.date)}
			<li><div class="card link"><span class="slot"></span><div class="content"><a class="name" href={x.href}>{x.label}</a><p class="meta-line">{title(x.date)}</p><p class="row-line">{dayExcerpt(x.day!) || x.day!.moods.map((m) => `${m.field}: ${m.value}`).join(' · ')}</p></div></div></li>
		{/each}
	</ul>
{/if}

{#if !days.length}
	{#if data.q || data.mood}<EmptyState kind="range" text="Nothing matches." />
	{:else if filtering}<EmptyState kind="filtered" text="Nothing in the last {data.days} days matches these filters." onclear={() => (view = { ...view, habit: null, areas: [], status: 'all' })} />
	{:else}<EmptyState kind="range" text={data.notesOnly ? `Nothing written in the last ${data.days} days. Journal fields, notes on logs and slips, and day notes show up here.` : `Nothing logged in the last ${data.days} days yet.`} />{/if}
{/if}

{#snippet note(it: Note, k: string, date: string, alone = '')}
	<!-- Under its row a note needs no name, only its field's; one that stands alone says what it is. -->
	<div class="hi-notewrap" class:note-of={alone}>
		{#if alone}<p class="meta"><span class="muted">{alone}</span> <a class="quiet hit" href={it.href} aria-label="Change {alone}, {title(date)}">Change</a></p>
		{:else if it.kind === 'field'}<p class="meta muted">{it.title.slice((it.habit ?? '').length).replace(/^ · /, '')}</p>{/if}
		<div class:hi-clamp={long(it.text) && !openNotes[k]}><Markdown text={it.text} small /></div>
		{#if long(it.text)}<button type="button" class="quiet hi-show hit" aria-expanded={!!openNotes[k]} aria-label="{openNotes[k] ? 'Show less' : 'Show the whole note'} of {alone || it.habit}, {title(date)}" onclick={() => (openNotes[k] = !openNotes[k])}>{openNotes[k] ? 'Show less' : 'Show the whole note'}</button>{/if}
	</div>
{/snippet}

<div class="hi-days">
	{#each days as day (day.date)}
		<section class="hi-day" id="d-{day.date}">
			<GroupHeading title={title(day.date)} {mode} count={!data.notesOnly && day.count.of ? `${day.count.done} of ${day.count.of}` : undefined} verb={data.canBackfill && day.date < data.today && (!data.windowFrom || day.date >= data.windowFrom) ? verb : undefined} />
			{#snippet verb()}<a class="quiet verb hit" href="/day/{day.date}" aria-label="Log {title(day.date)}">Log this day</a>{/snippet}
			{#each day.notes.day as it, i (i)}{@render note(it, `${day.date}:d${i}`, day.date, it.title)}{/each}
			{#if day.moods.length}<p class="tags moods">{#each day.moods as m (m.field + m.value)}<span class="tag">{m.field}: {m.value}</span>{/each}</p>{/if}
			{#if day.occurrences.length}
				<EditableList
					items={day.occurrences}
					key={(o) => o.id}
					label={(o) => `${o.habit}, ${title(day.date)}`}
					{mode}
					{selected}
					rowCard
					density="compact"
					href={(o) => hrefOf(o, day.date)}
					itemClass={(o) => (o.status === 'missed' ? 'hi-missed' : '')}
					ariaLabel={title(day.date)}
				>
					{#snippet row(o)}
						{@const out = outcome.get(o.id)}
						{#if mode === 'use'}<a class="name" href={hrefOf(o, day.date)}>{o.habit}</a>{:else}<span class="name">{o.habit}</span>{/if}
						{#if out?.tag}<span class="tags"><span class="tag pending"><span aria-hidden="true">→</span> {out.tag}</span></span>{/if}
						<p class="meta-line">{#if o.status !== 'missed'}<span class="mark" aria-hidden="true">{o.status === 'done' ? '✓' : '↷'}</span>{' '}{/if}{out?.reason ?? words(o)}</p>
						{#each day.notes.row.get(o.id) ?? [] as it, i (i)}{@render note(it, `${o.id}:${i}`, day.date)}{/each}
					{/snippet}
				</EditableList>
			{/if}
			{#if day.slips.length}
				<ul class="elist slips" data-mode="use" data-density="compact" aria-label="Slips on {title(day.date)}">
					{#each day.slips as s, i (i)}
						<li><div class="card link"><span class="slot"></span><div class="content"><a class="name" href="/day/{day.date}">{s.habit}</a><p class="meta-line">Slip{s.count !== 1 ? ` × ${s.count}` : ''}</p>{#each day.notes.slip.get(i) ?? [] as it, n (n)}{@render note(it, `${day.date}:s${i}:${n}`, day.date)}{/each}</div></div></li>
					{/each}
				</ul>
			{/if}
			{#each day.notes.rest as it, i (i)}{@render note(it, `${day.date}:${i}`, day.date, it.title)}{/each}
		</section>
	{/each}
</div>

{#if days.length && !data.q && !data.mood}
	<div class="hi-end">
		<a class="button" href={at({ days: data.days * 4 })} data-sveltekit-noscroll data-sveltekit-keepfocus>Show older</a>
		<span class="meta muted">Since {title(days.reduce((m, d) => (d.date < m ? d.date : m), days[0].date))}</span>
	</div>
{/if}
{#if data.canBackfill && data.windowFrom && days.some((d) => d.date < data.windowFrom!)}
	<p class="meta muted">Days before {title(data.windowFrom)} can only be looked at. <a href="/settings#past">Change it in Settings</a>.</p>
{/if}

<style>
	p,
	h2 {
		margin: 0;
	}
	.menu-at {
		position: relative;
		display: inline-flex;
	}
	.find {
		align-items: center;
		margin-block: var(--space-inline);
	}
	.slips {
		margin-block-start: var(--space-inline);
	}
	.moods {
		margin-block-end: var(--space-inline);
	}
	.note-of {
		padding: var(--space-inline) var(--space-group) 0;
	}
	.note {
		font-size: var(--font-size-note);
		line-height: 1rem;
	}
</style>
