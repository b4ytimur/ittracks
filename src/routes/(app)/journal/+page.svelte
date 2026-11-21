<script lang="ts">
	import { page } from '$app/state';
	import Markdown from '$lib/Markdown.svelte';
	import DayNote from '$lib/DayNote.svelte';
	import { dayExcerpt, type JournalDay } from '$lib/journal';

	let { data, form } = $props();

	const label = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.slice(0, 4) === data.today.slice(0, 4) ? undefined : 'numeric' });
	const dayHref = (d: string) => (d >= data.today ? '/' : `/day/${d}`);
	const ready = $derived(page.url.searchParams.get('ready'));
	const moodLine = (day: JournalDay) => day.moods.map((m) => `${m.field}: ${m.value}`).join(' · ');
</script>

<svelte:head><title>Journal · ittracks</title></svelte:head>

<header class="bar">
	<h1>Journal</h1>
	<div class="row">
		<a class="button small" href="/history">History</a>
		{#if !data.off}<a class="button small" href="/journal/export" download>Export</a>{/if}
	</div>
</header>

{#if data.off}
	<p class="card muted">The Journal is switched off. Nothing was deleted. <a href="/settings/features">Switch it on in Settings</a>.</p>
{:else}
	{#if ready}
		<p class="card small-text" role="status">
			{ready.includes('habit') ? 'Added the Journal habit to Today. ' : ''}{ready.includes('note') ? 'The day note is on Today now. ' : ''}You can change both in
			<a href="/settings/journal">Settings</a>.
		</p>
	{/if}

	{#if data.setup}
		<form method="POST" action="?/setup" class="card stack setup">
			<h2 style="margin: 0">Do you want a daily journal?</h2>
			<p class="muted small-text" style="margin: 0">
				Your journal is private: it never goes into templates or anything you share. Both can be changed later.
			</p>
			<label style="color: var(--text)"
				><input type="checkbox" name="habit" checked={!data.hasJournal} disabled={data.hasJournal} />
				Add a Journal habit: a few lines each evening with a daily prompt, and a mood you can chart in Stats{data.hasJournal
					? ' (you already have one)'
					: ''}</label
			>
			<label style="color: var(--text)"
				><input type="checkbox" name="dayNote" checked={!data.dayNoteOn} disabled={data.dayNoteOn} />
				Add a day note to Today: one free note per day, no streak{data.dayNoteOn ? ' (already on)' : ''}</label
			>
			{#if form?.error}<p class="error small-text" style="margin: 0">{form.error}</p>{/if}
			<div class="row">
				<button class="primary">Set up</button>
				{#if page.url.searchParams.has('setup')}<a class="button" href="/journal">Not now</a>{/if}
			</div>
		</form>
	{/if}

	{#if data.dayNote !== null && !data.filtered}
		<DayNote date={data.today} text={data.dayNote} link={false} />
	{/if}

	<form method="GET" class="filters row">
		<label class="grow">Search <input name="q" value={data.filters.q} type="search" placeholder="Words in any entry" /></label>
		{#if data.habits.length > 1}
			<label
				>Habit
				<select name="habit" value={data.filters.habit}>
					<option value="">Any</option>
					{#each data.habits as h (h.id)}<option value={h.id}>{h.name}</option>{/each}
				</select>
			</label>
		{/if}
		{#if data.moods.length}
			<label
				>Mood
				<select name="mood" value={data.filters.mood}>
					<option value="">Any</option>
					{#each data.moods as m (m)}<option>{m}</option>{/each}
				</select>
			</label>
		{/if}
		<button>Find</button>
		{#if data.filtered}<a class="button" href="/journal">Clear</a>{/if}
	</form>

	{#if data.lookBack.length}
		<section class="lookback">
			<h2>On this day</h2>
			<ul class="list">
				{#each data.lookBack as x (x.date)}
					<li>
						<a class="card" href={x.href}>
							<strong>{x.label}</strong> <span class="muted small-text">{label(x.date)}</span>
							<div class="small-text">{dayExcerpt(x.day!) || moodLine(x.day!)}</div>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if !data.days.length}
		<p class="muted">
			{#if data.filtered}Nothing written matches.{:else}Nothing written in the last {data.range} days. Journal fields, log notes, slip notes and day notes show up here.{/if}
		</p>
	{/if}

	{#each data.days as day (day.date)}
		<section class="day" id="d-{day.date}">
			<h2 class="dayhead"><a href={dayHref(day.date)}>{label(day.date)}</a></h2>
			{#if day.moods.length}
				<div class="chips moods">{#each day.moods as m (m.field + m.value)}<span class="chip">{m.field}: {m.value}</span>{/each}</div>
			{/if}
			{#each day.items as it, i (i)}
				<article class="card entry">
					<div class="row head">
						<span class="grow muted small-text">{it.title}</span>
						<a class="small-text" href={it.href}>Edit</a>
					</div>
					<Markdown text={it.text} />
				</article>
			{/each}
		</section>
	{/each}

	{#if data.days.length && !data.filtered}
		<p style="margin-top: 1.5rem"><a href="?days={data.range * 4}">Show older</a></p>
	{/if}
{/if}

<style>
	.small-text {
		font-size: 0.85rem;
	}
	.setup {
		margin-bottom: 1rem;
	}
	.filters {
		margin: 1rem 0 0.5rem;
	}
	.filters label:not(.grow) {
		width: 8rem;
	}
	.dayhead a {
		color: inherit;
		text-decoration: none;
	}
	.moods {
		margin: -0.25rem 0 0.5rem;
	}
	.entry .head {
		align-items: baseline;
		margin-bottom: 0.35rem;
	}
	.lookback .card {
		display: block;
	}
</style>
