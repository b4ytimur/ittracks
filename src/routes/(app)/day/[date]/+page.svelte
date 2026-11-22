<script lang="ts">
	import { isPartial, progressText } from '$lib/engine/progress';
	import { enhance } from '$app/forms';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import { onMount, untrack } from 'svelte';
	import { postAction, showToast } from '$lib/toast.svelte';
	import { queueable } from '$lib/queueable';
	import { addDays } from '$lib/engine/dates';
	import DayNote from '$lib/DayNote.svelte';
	import Markdown from '$lib/Markdown.svelte';

	let { data, form } = $props();

	type Item = (typeof data.due)[number];
	const levelName = { minimum: 'Minimum', target: 'Target', stretch: 'Stretch' } as const;
	const nice = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, opts);
	const short = (d: string) => nice(d, { weekday: 'short', day: 'numeric', month: 'short' });

	const prev = $derived(addDays(data.date, -1));
	const next = $derived(addDays(data.date, 1));
	const yesterday = $derived(addDays(data.today, -1));
	const canLog = $derived(data.window === 'ok');
	const back = $derived(encodeURIComponent(`/day/${data.date}`));
	const ago = $derived(Math.round((Date.parse(data.today) - Date.parse(data.date)) / 86_400_000));

	/** The Variant picked per habit, for habits with more than one. */
	let chosen = $state<Record<string, string>>({});
	const variantOf = (it: Item) => chosen[it.habitId] ?? it.variantId ?? '';

	const notLogged = (it: Item) => !it.occurrence || it.occurrence.status === 'missed' || it.occurrence.status === 'due';
	function statusText(it: Item): string {
		const o = it.occurrence;
		if (o?.status === 'done') {
			const p = data.progress[o.id];
			const detail = isPartial(p) ? ` · ${progressText(p!)}` : o.entries ? ` · ${o.entries} ${o.entries === 1 ? 'entry' : 'entries'}` : '';
			return `Done${it.levels && o.level ? ` at ${levelName[o.level]}` : ''}${detail}`;
		}
		if (o?.status === 'skipped') return 'Skipped';
		if (o?.status === 'missed') {
			// A day that got part of the way says how far.
			const p = o.entries ? data.progress[o.id] : null;
			return `Missed${p && isPartial(p) ? ` · ${progressText(p)}` : ''}`;
		}
		if (it.paused) return 'Paused that day';
		return it.wasDue ? 'Not logged' : 'Not due that day';
	}

	/** After a change: say what happened, and offer Undo. Offline, it waits on this device. */
	const after: SubmitFunction = queueable(`${short(untrack(() => data.date))}`, {
		onQueued: () => showToast(`Saved on this device. It will sync when you're back online.`),
		after: toastFor
	});
	function toastFor(result: ActionResult) {
		if (result.type !== 'success') return;
		const did = result.data?.did as { habit: string; verb: string; undo: string } | undefined;
		if (did?.verb) {
			showToast(`${did.verb} ${did.habit} on ${short(data.date)}.`, () =>
				postAction('?/restore', { snapshot: did.undo }).then(() => {})
			);
			return;
		}
		const slipped = result.data?.slipped as { id: string; habit: string; limit: boolean } | undefined;
		if (slipped) {
			showToast(`${slipped.limit ? 'Logged one' : 'Slip logged'} for ${slipped.habit} on ${short(data.date)}.`, () =>
				postAction('?/unslip', { id: slipped.id }).then(() => {})
			);
			return;
		}
		const started = result.data?.started as { habit: string } | undefined;
		if (started) {
			showToast(`${started.habit} now starts on ${short(data.date)}.`);
			return;
		}
		const removed = result.data?.unslipped as Record<string, unknown> | undefined;
		if (removed) showToast('Slip removed.', () => postAction('?/reslip', { slip: JSON.stringify(removed) }).then(() => {}));
	}

	// Back from the full log of this day.
	onMount(() => {
		const id = page.url.searchParams.get('did');
		if (!id) return;
		const item = [...data.due, ...data.other].find((x) => x.occurrence?.id === id);
		if (item) showToast(`Logged ${item.name} on ${short(data.date)}.`);
		const u = new URL(page.url);
		u.searchParams.delete('did');
		replaceState(u, {});
	});

	function jump(v: string) {
		if (!v) return;
		goto(v >= data.today ? '/' : `/day/${v}`);
	}
</script>

<svelte:head><title>{short(data.date)} · ittracks</title></svelte:head>

<header class="bar">
	<div>
		<h1>{nice(data.date)}</h1>
		<div class="muted">{ago === 1 ? 'Yesterday' : `${ago} days ago`} · logs here count like logs on the day</div>
	</div>
</header>

<nav class="row daynav" aria-label="Pick a day">
	<a class="button small" href="/day/{prev}" aria-label="Previous day, {short(prev)}">← {short(prev)}{data.prevUnlogged ? ` (${data.prevUnlogged} not logged)` : ''}</a>
	<input
		class="grow"
		type="date"
		value={data.date}
		max={yesterday}
		min={data.earliest ?? undefined}
		aria-label="Go to a day"
		onchange={(e) => jump(e.currentTarget.value)}
	/>
	{#if next < data.today}
		<a class="button small" href="/day/{next}" aria-label="Next day, {short(next)}">{short(next)} →</a>
	{:else}
		<a class="button small" href="/">Today →</a>
	{/if}
</nav>

{#if data.window === 'off'}
	<p class="card muted small-text">Logging past days is off, so this day can only be looked at. <a href="/settings/past-days">Change it in Settings</a>.</p>
{:else if data.window === 'tooOld'}
	<p class="card muted small-text">
		You can log up to {data.pastDays === 1 ? 'yesterday' : `${data.pastDays} days back`}, so this day can only be looked at. Slips can still be added.
		<a href="/settings/past-days">Change it in Settings</a>.
	</p>
{/if}

{#if form?.error && !form?.habit}<p class="error">{form.error}</p>{/if}

{#if data.dayNote !== null}
	{#key data.date}<DayNote date={data.date} text={data.dayNote} />{/key}
{/if}

<h2>Due that day</h2>
{#if data.due.length}
	<ul class="list">
		{#each data.due as item (item.habitId)}{@render row(item)}{/each}
	</ul>
{:else}
	<p class="muted">Nothing was due this day.</p>
{/if}

{#if data.other.length}
	<details class="other" open={!data.due.length || data.other.some((x) => x.occurrence)}>
		<summary>Not due that day ({data.other.length}). Did one anyway?</summary>
		<ul class="list">
			{#each data.other as item (item.habitId)}{@render row(item)}{/each}
		</ul>
	</details>
{/if}

{#if data.later.length}
	<h2>Started later</h2>
	<p class="muted small-text">
		These habits start after {short(data.date)}. If you really began on this day, start them from here and log it.
	</p>
	<ul class="list">
		{#each data.later as l (l.habitId)}
			<li class="card" id="h-{l.habitId}">
				<div class="row">
					<div class="grow">
						<strong>{l.name}</strong>
						<div class="muted small-text">Starts {short(l.startDate)}</div>
					</div>
					{#if l.direction === 'break' || canLog}
						<form method="POST" action="?/start" use:enhance={after}>
							<input type="hidden" name="habit" value={l.habitId} />
							<button aria-label="Start {l.name} from {short(data.date)}">Start from this day</button>
						</form>
					{/if}
				</div>
				{#if form?.habit === l.habitId && form?.error}<p class="error small-text">{form.error}</p>{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if data.breaking.length}
	<h2>Breaking</h2>
	<ul class="list">
		{#each data.breaking as b (b.habitId)}
			<li class="card stack" id="h-{b.habitId}">
				<div class="row">
					<a class="name grow" href="/habits/{b.habitId}/chain"><strong>{b.name}</strong></a>
					{#if b.limit}
						<span class="small-text" class:warn={b.limit.used > b.limit.max}
							>{b.limit.used} of {b.limit.max} {b.limit.period === 'week' ? 'that week' : 'that day'}</span
						>
					{/if}
				</div>
				{#if b.slips.length}
					<ul class="list slips">
						{#each b.slips as s (s.id)}
							<li class="row">
								<span class="grow small-text"
									>{b.limit ? `${s.count} logged` : `Slip${s.count !== 1 ? ` × ${s.count}` : ''}`}{s.time ? ` at ${s.time}` : ''}{s.feeling
										? ` · ${s.feeling}`
										: ''}</span
								>
								<form method="POST" action="?/unslip" use:enhance={after}>
									<input type="hidden" name="id" value={s.id} />
									<button class="link small-text" aria-label="Remove this slip">Remove</button>
								</form>
							</li>
						{/each}
					</ul>
				{:else}
					<div class="muted small-text">Clean that day.</div>
				{/if}
				<form method="POST" action="?/slip" class="row" use:enhance={after}>
					<input type="hidden" name="habit" value={b.habitId} />
					<label style="width: 5rem">Count <input name="count" type="number" min="1" max="1000" step="1" value="1" required /></label>
					<label style="width: 7rem">Time <input name="time" type="time" /></label>
					<button>{b.limit ? 'Log one' : 'Add slip'}</button>
				</form>
				{#if form?.habit === b.habitId && form?.error}<p class="error small-text">{form.error}</p>{/if}
			</li>
		{/each}
	</ul>
{/if}

{#snippet hidden(item: Item)}
	<input type="hidden" name="habit" value={item.habitId} />
	<input type="hidden" name="variant" value={variantOf(item)} />
{/snippet}

{#snippet row(item: Item)}
	{@const o = item.occurrence}
	{@const open = notLogged(item)}
	<li class="card" id="h-{item.habitId}" class:finished={!open}>
		<div class="row">
			<div class="grow">
				<a class="name" href="/habits/{item.habitId}/chain"><strong>{item.name}</strong></a>
				{#if item.variants.length && !(open && canLog)}<span class="chip">{item.variants.find((v) => v.id === item.variantId)?.name}</span>{/if}
				<div class="muted small-text" class:missed={o?.status === 'missed'}>{statusText(item)}</div>
				{#if o && data.notes[o.id]}<div class="lognote"><Markdown text={data.notes[o.id]} small /></div>{/if}
			</div>
			{#if canLog && open}
				{#if item.slotCount > 0}
					<form method="POST" action="?/open" use:enhance>
						{@render hidden(item)}
						<button class:primary={!item.canRepeat && !item.quickDone} aria-label="Log {item.name}">Log</button>
					</form>
					{#if item.canRepeat}
						<form method="POST" action="?/same" use:enhance={after}>
							{@render hidden(item)}
							<button class="primary" title="Copy your last log from before this day" aria-label="Same as last time: {item.name}">Same as last</button>
						</form>
					{:else if item.quickDone}
						<form method="POST" action="?/done" use:enhance={after}>
							{@render hidden(item)}
							<button class="primary" title="Log your targets" aria-label="Done: {item.name}">Done</button>
						</form>
					{/if}
				{:else}
					<form method="POST" action="?/done" use:enhance={after}>
						{@render hidden(item)}
						<input type="hidden" name="slots" value="0" />
						<button class="primary" aria-label="Done: {item.name}">Done</button>
					</form>
				{/if}
				{#if item.wasDue && o?.status !== 'skipped'}
					<form method="POST" action="?/skip" use:enhance={after}>
						{@render hidden(item)}
						<button aria-label="Skip {item.name}">Skip</button>
					</form>
				{/if}
			{:else if o}
				{#if item.slotCount > 0 && (o.status === 'done' || canLog)}
					<a class="button" href="/log/{o.id}?back={back}">{canLog ? (o.status === 'done' ? 'Edit' : 'Log') : 'View'}</a>
				{/if}
				{#if canLog}
					<form method="POST" action="?/clear" use:enhance={after}>
						{@render hidden(item)}
						<button class="link" aria-label="Clear {item.name}" title="Take this log away">Clear</button>
					</form>
				{/if}
			{/if}
		</div>
		{#if canLog && open && item.variants.length}
			<label class="variant small-text"
				>Variant
				<select value={variantOf(item)} onchange={(e) => (chosen[item.habitId] = e.currentTarget.value)}>
					{#each item.variants as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
				</select>
			</label>
		{/if}
		{#if canLog && open && item.levels && (item.slotCount === 0 || item.quickDone || item.canRepeat)}
			<div class="row levels">
				<span class="muted small-text">Or log</span>
				{#each ['minimum', 'stretch'] as const as l (l)}
					<form method="POST" action="?/done" use:enhance={after}>
						{@render hidden(item)}
						<input type="hidden" name="slots" value={item.slotCount} />
						<input type="hidden" name="level" value={l} />
						<button class="small" title={item.levels[l] || undefined}>{levelName[l]}</button>
					</form>
				{/each}
			</div>
		{/if}
		{#if form?.habit === item.habitId && form?.error}<p class="error small-text">{form.error}</p>{/if}
	</li>
{/snippet}

<style>
	.daynav {
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.daynav input {
		min-width: 9rem;
	}
	.name {
		color: inherit;
		text-decoration: none;
	}
	.finished {
		opacity: 0.75;
	}
	.lognote {
		margin-top: 0.3rem;
	}
	.missed {
		color: var(--danger);
	}
	.warn {
		color: var(--danger);
	}
	.small-text {
		font-size: 0.85rem;
	}
	.levels {
		align-items: center;
		margin-top: 0.4rem;
	}
	.variant {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
	.variant select {
		width: auto;
		margin: 0;
	}
	.other {
		margin-top: 1.25rem;
	}
	.other summary {
		cursor: pointer;
		color: var(--accent);
		margin-bottom: 0.5rem;
	}
	.slips li + li {
		margin-top: 0.25rem;
	}
	li:target {
		outline: 2px solid var(--accent);
	}
</style>
