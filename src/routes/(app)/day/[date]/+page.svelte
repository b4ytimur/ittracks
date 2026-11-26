<script lang="ts">
	import { isPartial, progressText } from '$lib/engine/progress';
	import { enhance } from '$app/forms';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import { onMount, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { showToast, undoWith } from '$lib/toast.svelte';
	import { queueable } from '$lib/queueable';
	import { addDays } from '$lib/engine/dates';
	import DayNote from '$lib/DayNote.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import EditableList from '$lib/ui/EditableList.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';
	import LogControl, { type Way } from '$lib/ui/LogControl.svelte';
	import { dayCount } from '$lib/history/day';
	import { usualWay } from '$lib/log/usual';

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
	/** Today travels (option 2 of "Other days"): the day's name while it is in the last week, its date before that. */
	const titleOf = $derived(ago === 1 ? 'Yesterday' : ago < 7 ? nice(data.date, { weekday: 'long' }) : nice(data.date, { day: 'numeric', month: 'long' }));
	const wide = new MediaQuery('min-width: 64rem');
	// A sideways swipe on a phone moves a day: to the right is the day before, to the left the day after.
	let start: { x: number; y: number } | null = null;
	const touch = (e: TouchEvent) => (start = { x: e.touches[0].clientX, y: e.touches[0].clientY });
	function swipe(e: TouchEvent) {
		if (!start) return;
		const dx = e.changedTouches[0].clientX - start.x;
		const dy = e.changedTouches[0].clientY - start.y;
		start = null;
		const on = e.target instanceof Element ? e.target : null;
		if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) / 2 || on?.closest('input, select, textarea, .menu')) return;
		jump(dx > 0 ? prev : next);
	}

	/** The Variant picked per habit, for habits with more than one. */
	let chosen = $state<Record<string, string>>({});
	const variantOf = (it: Item) => chosen[it.habitId] ?? it.variantId ?? '';

	const notLogged = (it: Item) => !it.occurrence || it.occurrence.status === 'missed' || it.occurrence.status === 'due';
	const trackers = $derived(new Set(data.tracking.map((x) => x.habitId)));
	function statusText(it: Item): string {
		const o = it.occurrence;
		// A tracker keeps what was logged: never done or missed.
		if (trackers.has(it.habitId)) return o && (o.status === 'done' || o.entries) ? `Logged${o.entries ? ` · ${o.entries} ${o.entries === 1 ? 'entry' : 'entries'}` : ''}` : 'Not logged';
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
			showToast(`${did.verb} ${did.habit} on ${short(data.date)}.`, undoWith(`/day/${data.date}?/restore`, { snapshot: did.undo }));
			return;
		}
		const slipped = result.data?.slipped as { id: string; habit: string; limit: boolean } | undefined;
		if (slipped) {
			showToast(`${slipped.limit ? 'Logged one' : 'Slip logged'} for ${slipped.habit} on ${short(data.date)}.`, undoWith(`/day/${data.date}?/unslip`, { id: slipped.id }));
			return;
		}
		const started = result.data?.started as { habit: string } | undefined;
		if (started) {
			showToast(`${started.habit} now starts on ${short(data.date)}.`);
			return;
		}
		const removed = result.data?.unslipped as Record<string, unknown> | undefined;
		if (removed) showToast('Slip removed.', undoWith(`/day/${data.date}?/reslip`, { slip: JSON.stringify(removed) }));
	}

	// Back from the full log of this day.
	onMount(() => {
		const id = page.url.searchParams.get('did');
		if (!id) return;
		const item = [...data.due, ...data.other, ...data.tracking].find((x) => x.occurrence?.id === id);
		if (item) showToast(`Logged ${item.name} on ${short(data.date)}.`);
		const u = new URL(page.url);
		u.searchParams.delete('did');
		replaceState(u, {});
	});

	function jump(v: string) {
		if (!v) return;
		goto(v >= data.today ? '/' : `/day/${v}`);
	}

	/** The usual way to log a habit on this day, and the others. */
	function waysOf(it: Item): { act: Way; ways: (Way | '-')[] } {
		const fields = { habit: it.habitId, variant: variantOf(it) };
		const o = it.occurrence;
		const skip: Way[] = it.wasDue && o?.status !== 'skipped' ? [{ label: 'Skip that day', action: '?/skip', fields, submit: after }] : [];
		const details: Way[] = it.slotCount > 0 ? [{ label: 'Log details…', action: '?/open', fields }] : [];
		const levels: Way[] =
			it.levels && (it.slotCount === 0 || it.quickDone || it.canRepeat)
				? (['minimum', 'target', 'stretch'] as const).map((l) => ({ label: levelName[l], value: it.levels![l], action: '?/done', fields: { ...fields, slots: String(it.slotCount), level: l }, submit: after }))
				: [];
		const rest = [...levels, ...details, ...(skip.length && (levels.length || details.length) ? ['-' as const] : []), ...skip];
		if (it.slotCount > 0) {
			const usual = usualWay(it);
			if (usual === 'done') return { act: { label: 'Done', action: '?/done', fields, submit: after }, ways: rest };
			if (usual === 'same') return { act: { label: 'Same as last', action: '?/same', fields, submit: after }, ways: rest };
			return { act: { label: 'Log', action: '?/open', fields }, ways: [...levels, ...skip] };
		}
		return { act: { label: 'Done', action: '?/done', fields: { ...fields, slots: '0' }, submit: after }, ways: [...levels, ...skip] };
	}
	const sorted = $derived([...data.due].sort((a, b) => Number(notLogged(b)) - Number(notLogged(a))));
	const count = $derived(dayCount(data.due.map((x) => ({ status: x.occurrence?.status ?? 'due', extra: false }))));
	let openOther = $state(untrack(() => !data.due.length || data.other.some((x) => x.occurrence)));
	let openSlip = $state<string | null>(null);
</script>

<svelte:head><title>{short(data.date)} · ittracks</title></svelte:head>

<!-- A swipe is a second way to move a day; the seven days are the first, for every pointer and the keyboard. -->
<svelte:window ontouchstart={touch} ontouchend={swipe} />
<div class="travels">
<EditChrome title={titleOf} modes={['use']}>
	{#snippet useHint()}
		<span class="day-line"><span>{nice(data.date, { day: 'numeric', month: 'long' })} · {ago === 1 ? 'yesterday' : `${ago} days ago`}</span>{#if count.of}<span class="num">{count.done} of {count.of} done</span>{/if}</span>
	{/snippet}
	{#snippet actions()}<a class="button" href="/">Back to today</a>{/snippet}
</EditChrome>

{#if !wide.current}{@render seven()}{/if}

{#if canLog}
	<p class="notice travel-note" role="note"><span class="notice-text">You are on {nice(data.date)}. What you log counts for that day.</span></p>
{/if}
{#if data.window === 'off' || data.window === 'tooOld'}
	<div class="notice">
		<span class="notice-text"
			>{data.window === 'off'
				? 'Logging past days is off, so this day can only be looked at.'
				: `You can log up to ${data.pastDays === 1 ? 'yesterday' : `${data.pastDays} days back`}, so this day can only be looked at. Slips can still be added.`}</span
		>
		<span class="notice-acts"><a class="quiet" href="/settings#past">Change it in Settings</a></span>
	</div>
{/if}
{#if form?.error && !form?.habit}<p class="error" role="alert">{form.error}</p>{/if}

{#if data.dayNote !== null}
	{#key data.date}<DayNote date={data.date} text={data.dayNote} />{/key}
{/if}

<div class="page-cols">
<div class="today-day">
<GroupHeading title="Due that day" />
{#if data.due.length}{@render list(sorted, 'Due that day')}{:else}<p class="empty-range">Nothing was due this day.</p>{/if}

{#if data.tracking.length}
	<GroupHeading title="Tracking" count={String(data.tracking.filter((x) => x.occurrence && (x.occurrence.status === 'done' || x.occurrence.entries)).length)} />
	{@render list(data.tracking, 'Tracking')}
{/if}

{#if data.other.length}
	<GroupHeading title="Not due that day" count={String(data.other.length)} folded={!openOther} onfold={() => (openOther = !openOther)} />
	{#if openOther}{@render list(data.other, 'Not due that day')}{/if}
{/if}

{#if data.later.length}
	<GroupHeading title="Started later" count={String(data.later.length)} />
	<EditableList items={data.later} key={(l) => l.habitId} label={(l) => l.name} mode="use" rowCard ariaLabel="Started later">
		{#snippet row(l)}
			<span class="name" id="h-{l.habitId}">{l.name}</span>
			<p class="meta-line">Starts {short(l.startDate)}. If you really began on this day, start it from here.</p>
			{#if form?.habit === l.habitId && form?.error}<p class="row-line error meta">{form.error}</p>{/if}
		{/snippet}
		{#snippet actions(l)}
			{#if l.direction === 'break' || canLog}
				<form method="POST" action="?/start" use:enhance={after}>
					<input type="hidden" name="habit" value={l.habitId} />
					<button class="quiet" aria-label="Start {l.name} from {short(data.date)}">Start from this day</button>
				</form>
			{/if}
		{/snippet}
	</EditableList>
{/if}

</div>
<div class="today-side">
{#if wide.current}<GroupHeading title="Last seven days" />{@render seven()}{/if}
{#if data.breaking.length}
	<GroupHeading title={data.breaking.some((b) => b.limit) ? 'Breaking and limiting' : 'Breaking'} />
	<EditableList items={data.breaking} key={(b) => b.habitId} label={(b) => b.name} mode="use" rowCard ariaLabel="Breaking">
		{#snippet row(b)}
			<a class="name" id="h-{b.habitId}" href="/habits/{b.habitId}/chain">{b.name}</a>
			<p class="meta-line">
				{[b.limit ? `${b.limit.used} of ${b.limit.max} ${b.limit.period === 'week' ? 'that week' : 'that day'}` : '', b.slips.length ? '' : 'Clean that day'].filter(Boolean).join(' · ')}
			</p>
			{#if b.limit && b.limit.used > b.limit.max}<p class="row-line warn meta">Over the limit.</p>{/if}
			{#each b.slips as s (s.id)}
				<div class="row-line slip">
					<span class="meta">{b.limit ? `${s.count} logged` : `Slip${s.count !== 1 ? ` × ${s.count}` : ''}`}{s.time ? ` at ${s.time}` : ''}{s.feeling ? ` · ${s.feeling}` : ''}</span>
					<form method="POST" action="?/unslip" use:enhance={after}>
						<input type="hidden" name="id" value={s.id} />
						<button class="quiet" aria-label="Remove this slip of {b.name}">Remove</button>
					</form>
				</div>
			{/each}
			{#if openSlip === b.habitId}
				<form method="POST" action="?/slip" class="row-line row" use:enhance={after}>
					<input type="hidden" name="habit" value={b.habitId} />
					<label>Count <input class="w-num" name="count" type="number" min="1" max="1000" step="1" value="1" required /></label>
					<label>Time <input class="w-time" name="time" type="time" /></label>
					<button>{b.limit ? 'Log' : 'Add slip'}</button>
				</form>
			{/if}
			{#if form?.habit === b.habitId && form?.error}<p class="row-line error meta">{form.error}</p>{/if}
		{/snippet}
		{#snippet actions(b)}<button type="button" class="quiet" aria-expanded={openSlip === b.habitId} aria-label="{b.limit ? 'Log one' : 'Log a slip'}: {b.name}" onclick={() => (openSlip = openSlip === b.habitId ? null : b.habitId)}>{b.limit ? 'Log one…' : 'Log a slip…'}</button>{/snippet}
	</EditableList>
{/if}

</div>
</div>
</div>

{#snippet seven()}
	<div class="seven">
		<div class="day-week" role="group" aria-label="Seven days around {short(data.date)}">
			{#each data.week as d (d.date)}
				{@const mark = d.of ? (d.done >= d.of ? 'done' : d.done ? 'partial' : d.date === data.today ? 'due' : 'missed') : null}
				{@const words = `${short(d.date)}: ${d.of ? `${d.done} of ${d.of} done` : 'nothing due'}`}
				<a class="day-cell" class:chosen={d.date === data.date} href={d.date === data.today ? '/' : `/day/${d.date}`} aria-current={d.date === data.date ? 'page' : undefined} aria-label={d.date === data.date ? `${words}, the day you are on` : d.date === data.today ? `${words}. Back to today.` : words}
					><span class="note">{nice(d.date, { weekday: 'narrow' })}</span><i data-day={mark} aria-current={d.date === data.today ? 'date' : undefined}></i><span class="note num">{Number(d.date.slice(8))}</span></a
				>
			{/each}
		</div>
		<label class="another meta">Another day <input type="date" value={data.date} max={yesterday} min={data.earliest ?? undefined} onchange={(e) => jump(e.currentTarget.value)} /></label>
	</div>
{/snippet}

{#snippet list(items: Item[], name: string)}
	<EditableList {items} key={(x) => x.habitId} label={(x) => x.name} mode="use" rowCard ariaLabel={name} itemClass={(x) => (x.occurrence?.status === 'done' ? 'done' : x.occurrence?.status === 'skipped' ? 'skipped' : '')}>
		{#snippet row(item)}
			{@const o = item.occurrence}
			{@const open = notLogged(item)}
			<a class="name" id="h-{item.habitId}" href="/habits/{item.habitId}/chain">{item.name}</a>
			<p class="meta-line">
				{#if o?.status === 'done' || o?.status === 'skipped'}<span class="mark" aria-hidden="true">{o.status === 'done' ? '✓' : '↷'}</span>{' '}{/if}{[
					statusText(item),
					item.variants.length && !(open && canLog) ? item.variants.find((v) => v.id === item.variantId)?.name : ''
				]
					.filter(Boolean)
					.join(' · ')}
			</p>
			{#if o && data.notes[o.id]}<div class="row-line"><Markdown text={data.notes[o.id]} small /></div>{/if}
			{#if canLog && open && item.variants.length}
				<label class="row-line variant meta"
					>Variant
					<select value={variantOf(item)} onchange={(e) => (chosen[item.habitId] = e.currentTarget.value)}>
						{#each item.variants as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
					</select>
				</label>
			{/if}
			{#if form?.habit === item.habitId && form?.error}<p class="row-line error meta">{form.error}</p>{/if}
		{/snippet}
		{#snippet actions(item)}
			{@const o = item.occurrence}
			{#if canLog && notLogged(item)}
				{@const w = waysOf(item)}
				<LogControl name="{item.name} on {short(data.date)}" act={w.act} ways={w.ways} />
			{:else if o}
				{#if item.slotCount > 0 && (o.status === 'done' || canLog)}<a class="quiet" href="/log/{o.id}?back={back}" aria-label="{o.status === 'done' ? (canLog ? 'Change' : 'View') : 'Log'} {item.name}">{o.status === 'done' ? (canLog ? 'Change' : 'View') : 'Log'}</a>{/if}
				{#if canLog}
					<form method="POST" action="?/clear" use:enhance={after}>
						<input type="hidden" name="habit" value={item.habitId} />
						<input type="hidden" name="variant" value={variantOf(item)} />
						<button class="quiet" aria-label="Clear {item.name} on {short(data.date)}">Clear</button>
					</form>
				{/if}
			{/if}
		{/snippet}
	</EditableList>
{/snippet}

<style>
	p {
		margin: 0;
	}
	.day-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-inline);
	}
	.day-line .num {
		color: var(--ink);
	}
	.travel-note {
		margin-block: var(--space-inline);
	}
	.seven {
		margin-block: var(--space-inline) var(--space-group);
		padding: var(--space-inline);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--surface-raised);
	}
	/* The day you are on: the chosen look (ink inset, 600), as every chooser has it. */
	.seven .day-cell.chosen {
		border-radius: var(--radius-inset);
		box-shadow: inset 0 0 0 var(--chosen-width) var(--line-chosen, var(--ink));
	}
	.seven .day-cell.chosen > .note {
		color: var(--ink);
		font-weight: 600;
	}
	.another {
		display: flex;
		align-items: center;
		gap: var(--space-inline);
		margin: var(--space-inline) 0 0;
		color: var(--ink-muted);
	}
	.another input {
		width: auto;
		margin: 0;
	}
	.slip form {
		flex: none;
	}
	.slip {
		display: flex;
		align-items: center;
		gap: var(--space-inline);
	}
	.variant {
		display: inline-flex;
		align-items: center;
		gap: var(--space-inline);
	}
	.variant select {
		width: auto;
	}
</style>
