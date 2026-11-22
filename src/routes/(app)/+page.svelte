<script lang="ts">
	import { enhance } from '$app/forms';
	import { queueable } from '$lib/queueable';
	import { postAction, showToast } from '$lib/toast.svelte';
	import type { ActionResult } from '@sveltejs/kit';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { outbox } from '$lib/outbox.svelte';
	import ViewBar from '$lib/ViewBar.svelte';
	import { viewOp } from '$lib/viewclient';
	import { headlineText } from '$lib/engine/stats';
	import { isPartial, progressText } from '$lib/engine/progress';
	import { rollupDay, rollupText } from '$lib/engine/rollup';
	import { invalidateAll } from '$app/navigation';
	import { addDays } from '$lib/engine/dates';
	import DayNote from '$lib/DayNote.svelte';
	import EditableList from '$lib/ui/EditableList.svelte';
	import EditButton from '$lib/ui/EditButton.svelte';
	import { reorderFrom } from '$lib/ui/list';
	import {
		DONE_MODES,
		LINES,
		SECTIONS,
		STATS,
		TODAY_STATUSES,
		WIDGETS,
		groupBy,
		initialState,
		manualOrder,
		partAt,
		passes,
		sectionOrder,
		type FeatureKey,
		type LineKey,
		type SectionKey,
		type StatKey,
		type WidgetKey
	} from '$lib/views';

	let { data, form } = $props();
	let slipOpen = $state<string | null>(null);
	let celebrating = $state<{ name: string; message: string; jar: string | null } | null>(null);

	// A finished habit with a reward gets a short celebration, from Today or from the Log screen.
	$effect(() => {
		const id = form?.finished ?? data.finished;
		const item = id ? data.build.find((b) => b.habitId === id) : null;
		if (!item?.reward?.celebrate) return;
		const jar = item.reward.jar;
		celebrating = {
			name: item.name,
			message:
				item.reward.message ||
				(item.identities.length ? 'Done. Another vote for who you want to be.' : 'Done. Nice work.'),
			jar: jar ? `${fmt(jar.total)} ${jar.unit}${jar.goal ? ` toward ${jar.goal}` : ''}` : null
		};
		if (data.finished) history.replaceState(history.state, '', '/');
		const t = setTimeout(() => (celebrating = null), 4500);
		return () => clearTimeout(t);
	});
	let feeling = $state('');

	/** Actions taken offline, shown as done until they sync. */
	let pending = $state<Record<string, 'done' | 'skipped'>>({});
	/** Logs finished offline and still waiting in the outbox count as done here. */
	const queuedDone = $derived(
		new Set(
			outbox.items.flatMap((q) => {
				const occ = q.fields.find(([k]) => k === 'occurrence')?.[1];
				if (occ && !q.url.includes('undo')) return [occ];
				const m = q.url.match(/^\/log\/([^/?]+)/);
				const p = q.fields.find(([k]) => k === 'payload')?.[1];
				return m && p?.includes('"finish":true') ? [m[1]] : [];
			})
		)
	);
	const statusOf = (o: { id: string; status: string }): string =>
		pending[o.id] ?? (queuedDone.has(o.id) && o.status === 'due' ? 'done' : o.status);

	// Back from a log or a quick-log link: say what was logged and offer Undo.
	onMount(() => {
		const id = page.url.searchParams.get('did');
		if (!id) return;
		const clear = page.url.searchParams.get('clear') === '1';
		// Finished short of what counts for this habit: it stays open, and says why.
		const short = page.url.searchParams.get('short');
		const item = data.build.find((b) => b.occurrence?.id === id);
		if (item && short && item.occurrence?.status === 'due')
			showToast(
				`Saved ${item.name}${item.progress ? `: ${progressText(item.progress)}` : ''}. It counts once it reaches ${short === 'target' ? 'the full target' : 'the Minimum'}, and stays open until the day ends.`,
				undefined,
				7000
			);
		else if (item) showToast(`Logged ${item.name}.`, () => postAction('?/undo', { occurrence: id, clear: clear ? '1' : '' }).then(() => {}));
		const u = new URL(page.url);
		u.searchParams.delete('did');
		u.searchParams.delete('clear');
		u.searchParams.delete('short');
		replaceState(u, {});
	});

	type Did = { occurrence: string; habit: string; clear: boolean; skipped?: boolean; short?: 'minimum' | 'target' };
	/** After a quick action: say what happened and offer Undo. */
	function afterDid(result: ActionResult) {
		if (result.type !== 'success') return;
		const did = result.data?.did as Did | undefined;
		if (!did) return;
		const undo = () => postAction('?/undo', { occurrence: did.occurrence, clear: did.clear ? '1' : '' }).then(() => {});
		// Short of what counts for this habit: it stays open, and says why.
		if (did.short)
			showToast(
				`Logged ${did.habit}. It counts once it reaches ${did.short === 'target' ? 'the full target' : 'the Minimum'}, and stays open until the day ends.`,
				undo,
				7000
			);
		else showToast(`${did.skipped ? 'Skipped' : 'Logged'} ${did.habit}.`, undo);
	}
	const quick = (occurrenceId: string, name: string, kind: 'done' | 'skipped' = 'done') =>
		queueable(`${name}`, {
			onQueued: () => {
				pending[occurrenceId] = kind;
				showToast(`${kind === 'skipped' ? 'Skipped' : 'Logged'} ${name}. It will sync when you're back online.`);
			},
			after: afterDid
		});

	/** +1 from Today: count one more toward the target, with Undo taking that tap back. */
	const plus = (occurrenceId: string, name: string) =>
		queueable(`${name}`, {
			onQueued: () => showToast(`Counted for ${name}. It will sync when you're back online.`),
			after: (result) => {
				if (result.type !== 'success') return;
				const p = result.data?.plus as { value: number; target: number; unit: string; done: boolean } | undefined;
				if (!p) return;
				const n = (x: number) => String(Math.round(x * 100) / 100);
				showToast(`${name}: ${n(p.value)} of ${n(p.target)}${p.unit ? ` ${p.unit}` : ''}${p.done ? '. Done!' : '.'}`, async () => {
					await postAction('?/plus', { occurrence: occurrenceId, by: '-1' });
					await invalidateAll();
				});
			}
		});
	const stepLabel = (p: { type: string; unit: string; step: number | null }) => {
		const step = p.step ?? (p.type === 'duration' ? 5 : p.unit === 'kg' ? 2.5 : p.unit === 'lb' || p.unit === 'lbs' ? 5 : 1);
		return `+${step}${p.type === 'duration' || (p.type === 'number' && p.unit) ? ` ${p.unit}` : ''}`;
	};

	// The one-time day question.
	let dayStart = $state('04:00');
	let ranges = $state(untrack(() => data.suggestedRanges.map((r) => ({ ...r }))));

	// ----- Views: filter, sort, group and layout, all saved per user -----
	let views = $state(untrack(() => data.views));
	let view = $state(untrack(() => initialState(data.views, 'today')));
	const featureOf: Partial<Record<LineKey, FeatureKey>> = {
		levels: 'levels',
		reframe: 'reframe',
		bundle: 'rewards',
		reward: 'rewards',
		progression: 'progression',
		identities: 'identities'
	};
	const hidden = (f: FeatureKey) => views.hidden.includes(f);
	const line = (k: LineKey) => views.today.lines.includes(k) && !(featureOf[k] && hidden(featureOf[k]!));
	const headlineOf = (item: Item) =>
		line('headline') ? (data.headlines[item.habitId] ?? headlineText(views.today.headlineFor[item.habitId] ?? views.today.headline, item.stats, item.streak)) : '';

	/** Change a Today layout setting here at once, and save it. */
	function setToday(patch: Partial<typeof views.today>) {
		views.today = { ...views.today, ...patch };
		viewOp({ op: 'patch', today: patch });
	}
	const sections = $derived(sectionOrder(views));
	const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

	// ----- Edit mode: the same page, with widgets, sections and habits to drag, hide and show -----
	let editing = $state(false);
	/** Every widget, the shown ones first in their order. */
	const allWidgets = $derived([...views.today.widgets, ...(Object.keys(WIDGETS) as WidgetKey[]).filter((w) => !views.today.widgets.includes(w))]);
	const reorderWidgets = (order: string[]) => setToday({ widgets: (order as WidgetKey[]).filter((w) => views.today.widgets.includes(w)) });
	const reorderSections = (order: string[]) => setToday({ sections: order.map((k) => sections.find((s) => s.key === k)!) });
	const toggleSection = (k: SectionKey) => setToday({ sections: sections.map((x) => (x.key === k ? { ...x, show: !x.show } : x)) });
	/** A list of habits was reordered: it goes into the one habit order (My order), shared with the Habits page. */
	function reorderHabits(part: string[]) {
		const ids = [...data.build, ...data.resting].map((b) => b.habitId);
		const all = [...views.today.order, ...ids.filter((id) => !views.today.order.includes(id))];
		setToday({ order: reorderFrom(all, shownBuild.map((b) => b.habitId), part, view.sort === 'manual') });
		if (view.sort !== 'manual') {
			view.sort = 'manual';
			showToast('Sorted by My order, shared with the Habits page.');
		}
	}
	function setHeadline(habitId: string, v: string) {
		const next = { ...views.today.headlineFor };
		if (v) next[habitId] = v as StatKey;
		else delete next[habitId];
		setToday({ headlineFor: next });
	}

	// The time of day, for the time-aware view. Ticks once a minute.
	let now = $state(nowTimeInit());
	function nowTimeInit() {
		return new Date().toTimeString().slice(0, 5);
	}
	onMount(() => {
		const t = setInterval(() => (now = nowTimeInit()), 60_000);
		return () => clearInterval(t);
	});
	const partNames = $derived(data.ranges.map((r) => r.name));
	const currentPart = $derived(partAt(data.ranges, now));
	const partOf = (b: Item) => b.cue.range ?? (b.cue.time ? partAt(data.ranges, b.cue.time) : null);
	let showAll = $state(false);

	/** Every habit the view lets through, groups and the habits inside them alike. */
	const filtered = $derived.by(() => {
		let list = data.build.filter((b) => passes(view, { ...b, direction: 'build' }));
		if (view.status === 'due') list = list.filter((b) => statusOf(b.occurrence!) === 'due');
		if (view.status === 'done') list = list.filter((b) => statusOf(b.occurrence!) !== 'due');
		if (view.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
		if (view.sort === 'manual') list = manualOrder(list, views.today.order, (b) => b.habitId);
		if (view.sort === 'streak') list = [...list].sort((a, b) => Number(b.atRisk) - Number(a.atRisk));
		return list;
	});
	// A habit whose group is shown sits inside the group's card; the rest stand on their own.
	const shownIds = $derived(new Set(filtered.map((b) => b.habitId)));
	const sorted = $derived(filtered.filter((b) => !b.parentId || !shownIds.has(b.parentId)));
	const kidsOf = (id: string) => filtered.filter((b) => b.parentId === id);
	/** A group's count today, live: habits done offline count at once. */
	const groupNow = (item: Item) => {
		const g = item.group!;
		const kids = data.build.filter((b) => b.parentId === item.habitId && b.occurrence);
		if (!kids.length) return { done: g.done, total: g.total, status: statusOf(item.occurrence!) };
		const day = rollupDay(kids.map((k) => ({ status: statusOf(k.occurrence!) as 'due' | 'done' | 'skipped' | 'missed' })), g, { past: false });
		return day ? { done: day.done, total: day.total, status: day.status } : { done: g.done, total: g.total, status: statusOf(item.occurrence!) };
	};
	/** The time-aware view keeps what fits now, what's still due from earlier, and anything without a time. */
	const timeHidden = $derived.by(() => {
		if (!views.today.timeAware || showAll || !currentPart) return new Set<string>();
		const at = partNames.indexOf(currentPart);
		return new Set(
			sorted
				.filter((b) => {
					const p = partOf(b);
					if (!p || !partNames.includes(p) || p === currentPart) return false;
					const earlier = partNames.indexOf(p) < at;
					return !(earlier && statusOf(b.occurrence!) === 'due');
				})
				.map((b) => b.habitId)
		);
	});
	const isDone = (b: Item) => statusOf(b.occurrence!) !== 'due';
	const shownBuild = $derived.by(() => {
		let list = sorted.filter((b) => !timeHidden.has(b.habitId));
		const mode = views.today.done;
		if (mode === 'bottom') list = [...list.filter((b) => !isDone(b)), ...list.filter(isDone)];
		if (mode === 'collapse' || mode === 'hide') list = list.filter((b) => !isDone(b));
		return list;
	});
	const doneFolded = $derived(
		views.today.done === 'collapse' || views.today.done === 'hide' ? sorted.filter((b) => !timeHidden.has(b.habitId) && isDone(b)) : []
	);
	let showDone = $state(false);
	const groups = $derived(
		groupBy(
			shownBuild.map((b) => ({ ...b, part: partOf(b) })),
			view.group,
			{ areas: data.areas, parts: partNames }
		)
	);
	const breakingShown = $derived(data.breaking.filter((b) => passes(view, { ...b, direction: 'break' })));
	const showSection = (k: SectionKey) =>
		view.direction === 'build' ? k !== 'breaking' : view.direction === 'break' ? k === 'breaking' : true;
	const identityNames = $derived([...new Set([...data.build, ...data.breaking].flatMap((b) => b.identities))].sort());
	// A group is counted through the habits inside it.
	const doneCount = $derived(data.build.filter((b) => !b.group && isDone(b)).length);
	const atRiskItems = $derived(data.build.filter((b) => b.atRisk && !isDone(b)));
	const weekdayShort = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });

	// "Yesterday wasn't logged": hidden on this device until the next day, once dismissed.
	const yesterday = $derived(addDays(data.today, -1));
	let nudgeHiddenFor = $state<string | null>(null);
	onMount(() => {
		try {
			nudgeHiddenFor = localStorage.getItem('nudge-hidden');
		} catch {
			/* storage blocked */
		}
	});
	function hideNudge() {
		nudgeHiddenFor = yesterday;
		try {
			localStorage.setItem('nudge-hidden', yesterday);
		} catch {
			/* storage blocked */
		}
	}

	const dateLabel = $derived(
		new Date(data.today + 'T12:00:00').toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const fmt = (n: number) =>
		n.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
	const shortDate = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
	const limiting = $derived(data.breaking.some((b) => b.limit));
	const nowTime = () => new Date().toTimeString().slice(0, 5);
	const levelName = { minimum: 'Minimum', target: 'Target', stretch: 'Stretch' } as const;

	type Item = (typeof data.build)[number];
	const cueLine = (c: Item['cue']) =>
		[c.after ? `after ${c.after}` : null, c.time ?? c.range, c.place].filter(Boolean).join(' · ');
	const triggerLine = (t: { kind: string; label: string; percent: number }) =>
		t.kind === 'feeling'
			? `${t.percent}% when ${t.label}`
			: t.kind === 'place'
				? `${t.percent}% at ${t.label}`
				: t.kind === 'with'
					? `${t.percent}% ${/^alone$/i.test(t.label) ? 'alone' : `with ${t.label}`}`
					: `${t.percent}% ${t.label}`;
</script>

<svelte:head><title>Today · ittracks</title></svelte:head>

<header class="bar">
	<div>
		<h1>Today</h1>
		<div class="muted">{dateLabel}{#if data.canBackfill}{' · '}<a href="/day">Log a past day</a>{/if}</div>
	</div>
	{#if !hidden('identities')}<a href="/identities">Identities</a>{/if}
</header>

{#if data.askDay}
	<form method="POST" action="?/day" class="card stack ask" use:enhance>
		<strong>When does your day start?</strong>
		<p class="muted small-text" style="margin: 0.25rem 0 0">
			Anything you log before this time counts for the day before, so a late night doesn't break a streak.
		</p>
		<label style="width: 8rem">Day starts at <input type="time" name="dayStart" bind:value={dayStart} required /></label>
		<div>
			<span class="muted small-text">Parts of your day (optional). Habits can be set for a part instead of a time.</span>
			{#each ranges as r, i (i)}
				<div class="range">
					<input class="grow" name="rangeName" bind:value={r.name} aria-label="Name" />
					<input type="time" name="rangeStart" bind:value={r.start} aria-label="{r.name} starts" />
					<input type="time" name="rangeEnd" bind:value={r.end} aria-label="{r.name} ends" />
					<button type="button" class="small" onclick={() => ranges.splice(i, 1)} aria-label="Remove {r.name}">×</button>
				</div>
			{/each}
			<button type="button" class="small" onclick={() => ranges.push({ name: '', start: '12:00', end: '13:00' })}>+ part</button>
		</div>
		<fieldset class="stack">
			<legend><strong>How much do you want to see?</strong></legend>
			<span class="muted small-text">Pick a starting layout. Every part of it can be changed later.</span>
			{#each data.templates as t (t.id)}
				<label class="tpl" style="color: var(--text)"
					><input type="radio" name="template" value={t.id} checked={t.id === data.suggestedTemplate} />
					<span><strong>{t.name}</strong>{t.id === data.suggestedTemplate ? ' (suggested)' : ''}<br /><span class="muted small-text">{t.blurb}</span></span></label
				>
			{/each}
		</fieldset>
		<div class="row">
			<button class="primary">Save</button>
			<span class="muted small-text grow">You can change this any time in Settings.</span>
		</div>
	</form>
{/if}

{#if data.unlogged.length && nudgeHiddenFor !== yesterday}
	<div class="card nudge row" role="status">
		<span class="grow small-text"
			>Yesterday {data.unlogged.length === 1 ? 'one habit was' : `${data.unlogged.length} habits were`} not logged: {data.unlogged
				.slice(0, 3)
				.join(', ')}{data.unlogged.length > 3 ? ' and more' : ''}. Did you do {data.unlogged.length === 1 ? 'it' : 'them'}?</span
		>
		<a class="button small primary" href="/day/{yesterday}">Log yesterday</a>
		<button class="small link" onclick={hideNudge} aria-label="Hide this until tomorrow">Hide</button>
	</div>
{/if}

{#if !data.build.length && !data.resting.length && !data.breaking.length && !data.paused.length}
	<p class="muted">Nothing here yet. <a href="/habits/new">Create a habit</a> or <a href="/gallery">pick a ready-made one</a>.</p>
{:else}
	<ViewBar
		page="today"
		bind:views
		bind:current={view}
		areas={data.areas}
		identities={hidden('identities') ? [] : identityNames}
		statuses={TODAY_STATUSES}
		direction={data.breaking.length > 0}
	>
		{#snippet end()}<EditButton bind:editing look="chip" />{/snippet}
	</ViewBar>

	{#if editing}
		{@render layoutPanel()}
		<EditableList
			layout="block"
			items={allWidgets}
			key={(w) => w}
			label={(w) => WIDGETS[w]}
			editing
			ariaLabel="Widgets at the top"
			onmove={(_, order) => reorderWidgets(order)}
			onremove={(w) => setToday({ widgets: toggleIn(views.today.widgets, w) })}
			removeLabel={(w) => (views.today.widgets.includes(w) ? 'Hide' : 'Show')}
		>
			{#snippet title(w)}Widget: {WIDGETS[w]}{views.today.widgets.includes(w) ? '' : ' (hidden)'}{/snippet}
			{#snippet row(w)}
				{#if views.today.widgets.includes(w)}{@render widget(w)}{/if}
			{/snippet}
		</EditableList>
	{:else}
		{#each views.today.widgets as w (w)}
			{@render widget(w)}
		{/each}
	{/if}
{/if}

{#if editing}
	<EditableList
		class="sections"
		layout="block"
		items={sections}
		key={(s) => s.key}
		label={(s) => SECTIONS[s.key]}
		editing
		ariaLabel="Sections of Today"
		onmove={(_, order) => reorderSections(order)}
		onremove={(s) => toggleSection(s.key)}
		removeLabel={(s) => (s.show ? 'Hide' : 'Show')}
	>
		{#snippet title(sec)}{sec.key === 'breaking' && !limiting ? 'Breaking' : SECTIONS[sec.key]}{sec.show ? '' : ' (hidden)'}{/snippet}
		{#snippet row(sec)}
			{#if sec.show && showSection(sec.key)}{@render section(sec.key)}{/if}
		{/snippet}
	</EditableList>
{:else}
	{#each sections as sec (sec.key)}
		{#if sec.show && showSection(sec.key)}{@render section(sec.key)}{/if}
	{/each}
{/if}

{#snippet section(key: SectionKey)}
	{#if key === 'due'}{@render dueSection()}
	{:else if key === 'breaking'}{@render breakingSection()}
	{:else if key === 'prep'}{@render prepSection()}
	{:else if key === 'paused'}{@render pausedSection()}
	{:else}{@render restingSection()}{/if}
{/snippet}

{#snippet widget(w: WidgetKey)}
	{#if w === 'progress' && data.build.length}
		<div class="card widget">
			<div class="row"><strong class="grow">{doneCount} of {data.build.length} done today</strong></div>
			<progress max={data.build.length} value={doneCount} aria-label="Done today"></progress>
		</div>
	{:else if w === 'week'}
		<div class="card widget week" role="group" aria-label="This week">
			{#each data.week as d (d.date)}
				{#if d.date < data.today && data.canBackfill}
					<a class="day" class:full={d.of > 0 && d.done === d.of} href="/day/{d.date}" aria-label="Log {shortDate(d.date)}">
						<span class="muted small-text">{weekdayShort(d.date)}</span>
						<span>{d.of ? `${d.done}/${d.of}` : '–'}</span>
					</a>
				{:else}
					<div class="day" class:today={d.date === data.today} class:full={d.of > 0 && d.done === d.of}>
						<span class="muted small-text">{weekdayShort(d.date)}</span>
						<span>{d.date > data.today ? '' : d.of ? `${d.done}/${d.of}` : '–'}</span>
					</div>
				{/if}
			{/each}
		</div>
	{:else if w === 'atRisk' && atRiskItems.length}
		<div class="card widget">
			<strong>Streaks at risk</strong>
			{#each atRiskItems as b (b.habitId)}
				<div class="small-text warn">{b.name}: missed last time, don't miss twice.</div>
			{/each}
		</div>
	{:else if w === 'quit' && data.breaking.length}
		<div class="card widget">
			{#each data.breaking as b (b.habitId)}
				<div class="row">
					<span class="grow">{b.name}</span>
					<strong>{plural(b.days, b.limit?.period === 'week' ? 'week' : 'day')}</strong>
					{#if b.cost?.saved && !hidden('cost')}<span class="muted small-text">saved {fmt(b.cost.saved)} {b.cost.unit}</span>{/if}
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet layoutPanel()}
	<div class="card stack layout">
		<p class="muted small-text" style="margin: 0">
			Drag ⠿ to move widgets, sections and habits; Hide or Show each one. Moving habits changes My order, shared with the Habits page.
		</p>
		<div class="row">
			<label class="grow"
				>Done items
				<select value={views.today.done} onchange={(e) => setToday({ done: e.currentTarget.value as keyof typeof DONE_MODES })}>
					{#each Object.entries(DONE_MODES) as [k, label] (k)}<option value={k}>{label}</option>{/each}
				</select>
			</label>
			<label class="grow"
				>Headline number
				<select value={views.today.headline} onchange={(e) => setToday({ headline: e.currentTarget.value as StatKey })}>
					{#each Object.entries(STATS) as [k, label] (k)}<option value={k}>{label}</option>{/each}
				</select>
			</label>
		</div>
		<label style="color: var(--text)"
			><input
				type="checkbox"
				checked={views.today.timeAware}
				disabled={!data.ranges.length}
				onchange={() => setToday({ timeAware: !views.today.timeAware })}
			/>
			Only show what fits the current part of the day{data.ranges.length ? '' : ' (add parts of your day in Settings first)'}</label
		>
		<div>
			<span class="muted small-text">Lines on each habit</span>
			<div class="chips" role="group" aria-label="Lines on each habit">
				{#each Object.entries(LINES) as [k, label] (k)}
					{@const f = featureOf[k as LineKey]}
					{#if !f || !hidden(f)}
						<button
							type="button"
							class="chip small"
							class:on={views.today.lines.includes(k as LineKey)}
							aria-pressed={views.today.lines.includes(k as LineKey)}
							onclick={() => setToday({ lines: toggleIn(views.today.lines, k as LineKey) })}>{label}</button
						>
					{/if}
				{/each}
			</div>
		</div>
		<p class="muted small-text" style="margin: 0">To switch template, go to <a href="/settings/views">Settings, Views</a>. To hide whole features, go to <a href="/settings/features">Settings, Features</a>.</p>
	</div>
{/snippet}

{#snippet habitList(items: Item[], name: string)}
	<EditableList {items} key={(b) => b.habitId} label={(b) => b.name} {editing} ariaLabel={name} onmove={(_, order) => reorderHabits(order)}>
		{#snippet row(item)}{@render card(item)}{/snippet}
	</EditableList>
{/snippet}

{#snippet headlinePick(item: Item)}
	<label class="headline-pick small-text"
		>Headline
		<select value={views.today.headlineFor[item.habitId] ?? ''} onchange={(e) => setHeadline(item.habitId, e.currentTarget.value)}>
			<option value="">Default ({STATS[views.today.headline]})</option>
			{#each Object.entries(STATS) as [k, label] (k)}<option value={k}>{label}</option>{/each}
		</select>
	</label>
{/snippet}

{#snippet dueSection()}
	{#each groups as g (g.key)}
		{#if g.label}
			<h2 class="area" style="--area: {g.color ?? 'var(--border)'}">{g.label}</h2>
		{/if}
		{@render habitList(g.items, g.label || 'Due today')}
	{/each}
	{#if timeHidden.size}
		<p class="muted small-text">
			Showing what fits {currentPart}. <button class="link" onclick={() => (showAll = true)}>Show all ({timeHidden.size} more)</button>
		</p>
	{:else if showAll && views.today.timeAware}
		<p class="muted small-text"><button class="link" onclick={() => (showAll = false)}>Only show what fits now</button></p>
	{/if}
	{#if doneFolded.length}
		{#if views.today.done === 'collapse'}
			<button class="link small-text" aria-expanded={showDone} onclick={() => (showDone = !showDone)}>Done ({doneFolded.length})</button>
			{#if showDone}
				<div style="margin-top: 0.5rem">{@render habitList(doneFolded, 'Done today')}</div>
			{/if}
		{:else}
			<p class="muted small-text">{doneFolded.length} done today, hidden.</p>
		{/if}
	{/if}
{/snippet}

{#snippet card(item: Item)}
	{#if item.group}
		{@render groupCard(item)}
	{:else}
		{@render habitCard(item)}
	{/if}
{/snippet}

{#snippet groupCard(item: Item)}
	{@const g = groupNow(item)}
	{@const kids = kidsOf(item.habitId)}
	<div class="card group" class:stacked={!!item.afterHabitId}>
		<div class="row" class:finished={g.status !== 'due'}>
			<div class="grow">
				<a class="name" href="/habits/{item.habitId}/chain"><strong>{item.name}</strong></a>
				{#if line('cue') && cueLine(item.cue)}<div class="muted small-text">{cueLine(item.cue)}</div>{/if}
				<div class="muted small-text">
					{#if g.status === 'done'}Done{#if item.occurrence?.level === 'minimum'}&nbsp;at Minimum{/if}{:else if g.status === 'skipped'}Skipped{:else}Due{/if}
					{#if g.total}<span class="progress">· {rollupText(g)}</span>{/if}
					{#if headlineOf(item)}· {headlineOf(item)}{/if}
				</div>
				{#if g.status === 'due' && g.total}
					<progress class="bar" max={g.total} value={g.done} aria-label="{item.name}: {rollupText(g)}"></progress>
				{/if}
				{#if item.atRisk && g.status === 'due'}
					<div class="warn small-text">You missed last time. Don't miss twice.</div>
				{/if}
				{#if item.reframe && line('reframe')}<div class="reframe small-text">{item.reframe}</div>{/if}
			</div>
		</div>
		{#if kids.length}
			<div class="inside">{@render habitList(kids, `Inside ${item.name}`)}</div>
		{/if}
		{#if item.identities.length && line('identities')}
			<div class="votes small-text">Vote for: {item.identities.join(' · ')}</div>
		{/if}
	</div>
{/snippet}

{#snippet habitCard(item: Item)}
	{@const o = item.occurrence!}
	{@const st = statusOf(o)}
	{@const levels = item.levels}
	<div class="card" class:finished={st !== 'due'} class:stacked={!!item.afterHabitId} class:next={item.upNext}>
		<div class="row">
			<div class="grow">
				<a class="name" href="/habits/{item.habitId}/chain"><strong>{item.name}</strong></a>
				{#if item.multiVariant && o.variantName}<span class="chip">{o.variantName}</span>{/if}
				{#if item.upNext}<span class="chip on">Up next</span>{/if}
				{#if item.inProgress && st === 'due'}<span class="chip on">In progress</span>{/if}
				{#if line('cue') && cueLine(item.cue)}<div class="muted small-text">{cueLine(item.cue)}</div>{/if}
				<div class="muted small-text">
					{#if st === 'done'}Done{#if levels}&nbsp;at {levelName[o.level ?? 'target']}{/if}{:else if st === 'skipped'}Skipped{:else}Due{/if}
					{#if item.progress && st !== 'skipped' && (st === 'due' || isPartial(item.progress))}<span class="progress">· {progressText(item.progress)}</span>{/if}
					{#if headlineOf(item)}· {headlineOf(item)}{/if}
				</div>
				{#if item.progress && st === 'due' && (item.progress.kind === 'steps' || item.progress.value > 0)}
					<progress
						class="bar"
						max={item.progress.kind === 'steps' ? item.progress.total : item.progress.target}
						value={item.progress.kind === 'steps' ? item.progress.done : item.progress.value}
						aria-label="{item.name}: {progressText(item.progress)}"
					></progress>
				{/if}
				{#if item.atRisk && st === 'due'}
					<div class="warn small-text">You missed last time. Don't miss twice{levels ? ': even the Minimum counts' : ''}.</div>
				{/if}
				{#if levels && line('levels') && st === 'due' && levels.minimum}
					<div class="muted small-text">Minimum: {levels.minimum}</div>
				{/if}
				{#if item.reframe && line('reframe')}<div class="reframe small-text">{item.reframe}</div>{/if}
				{#if item.bundle && line('bundle')}
					<div class="small-text bundle">
						{#if item.bundle.strict}
							{o.status === 'done' ? `Earned: ${item.bundle.reward}` : `After this: ${item.bundle.reward}`}
						{:else}
							Pair with: {item.bundle.reward}
						{/if}
					</div>
				{/if}
				{#if item.reward?.jar && line('reward')}
					<div class="muted small-text">
						Jar: {fmt(item.reward.jar.total)} {item.reward.jar.unit}{item.reward.jar.goal ? ` toward ${item.reward.jar.goal}` : ''}
					</div>
				{/if}
			</div>
			{#if editing}
				<!-- Edit mode is for the layout: the buttons for logging come back when it's done. -->
			{:else if st === 'due'}
				{#if item.progress?.kind === 'amount' && !pending[o.id]}
					<form method="POST" action="?/plus" use:enhance={plus(o.id, item.name)}>
						<input type="hidden" name="occurrence" value={o.id} />
						<button class="primary" title="Count one more toward {item.progress.target}" aria-label="{stepLabel(item.progress)} for {item.name}">{stepLabel(item.progress)}</button>
					</form>
					<a class="button" href="/log/{o.id}" aria-label="Log {item.name}">Log</a>
				{:else if o.slotCount > 0}
					{#if item.inProgress}
						<a class="button primary" href="/log/{o.id}" aria-label="Resume {item.name}">Resume</a>
					{:else}
						<a class="button" class:primary={!item.canRepeat && !item.quickDone} href="/log/{o.id}" aria-label="Log {item.name}">Log</a>
						{#if item.canRepeat}
							<form method="POST" action="?/same" use:enhance={quick(o.id, item.name)}>
								<input type="hidden" name="occurrence" value={o.id} />
								<button class="primary" title="Copy your last log and finish" aria-label="Same as last time: {item.name}">Same as last</button>
							</form>
						{:else if item.quickDone}
							<form method="POST" action="?/quick" use:enhance={quick(o.id, item.name)}>
								<input type="hidden" name="occurrence" value={o.id} />
								<button class="primary" title="Log your targets" aria-label="Done: {item.name}">Done</button>
							</form>
						{/if}
					{/if}
				{:else}
					<form method="POST" action="?/done" use:enhance={quick(o.id, item.name)}>
						<input type="hidden" name="occurrence" value={o.id} />
						<button class="primary" aria-label="Done: {item.name}">Done</button>
					</form>
				{/if}
				<form method="POST" action="?/skip" use:enhance={quick(o.id, item.name, 'skipped')}>
					<input type="hidden" name="occurrence" value={o.id} />
					<button aria-label="Skip {item.name}">Skip</button>
				</form>
			{:else if !pending[o.id]}
				{#if o.slotCount > 0}<a class="button" href="/log/{o.id}">View</a>{/if}
				<form method="POST" action="?/undo" use:enhance>
					<input type="hidden" name="occurrence" value={o.id} />
					<button class="link" aria-label="Undo {item.name}">Undo</button>
				</form>
			{/if}
		</div>
		{#if levels && line('levels') && st === 'due' && !item.inProgress && (o.slotCount === 0 || item.quickDone || item.canRepeat)}
			<div class="row levels">
				<span class="muted small-text">Or log</span>
				{#each ['minimum', 'stretch'] as const as l (l)}
					<form method="POST" action={o.slotCount ? '?/quick' : '?/done'} use:enhance={quick(o.id, item.name)}>
						<input type="hidden" name="occurrence" value={o.id} />
						<input type="hidden" name="level" value={l} />
						<button class="small" title={levels[l] || undefined}>{levelName[l]}</button>
					</form>
				{/each}
			</div>
		{/if}
		{#if item.progression && line('progression')}
			{@const p = item.progression}
			<div class="suggest">
				<span class="small-text"
					>You've hit your targets {p.hits} times in a row. Raise them by {p.by}{p.unit === 'percent' ? '%' : p.by === 1 ? ' step' : ' steps'}?</span
					>
					{#each p.changes as line (line)}<div class="muted small-text">{line}</div>{/each}
				<div class="row">
					<form method="POST" action="?/raise" use:enhance>
						<input type="hidden" name="habit" value={item.habitId} />
						<button class="small primary">Raise</button>
					</form>
					<form method="POST" action="?/notYet" use:enhance>
						<input type="hidden" name="habit" value={item.habitId} />
						<button class="small">Not yet</button>
					</form>
				</div>
			</div>
		{/if}
		{#if form?.raised === item.habitId}<p class="muted small-text">Targets raised. Keep going.</p>{/if}
		{#if item.identities.length && line('identities')}
			<div class="votes small-text">Vote for: {item.identities.join(' · ')}</div>
		{/if}
		{#if editing}{@render headlinePick(item)}{/if}
	</div>
{/snippet}

{#snippet breakingSection()}
	{#if breakingShown.length}
		{#if !editing}<h2>{limiting ? 'Breaking and limiting' : 'Breaking'}</h2>{/if}
		<ul class="list">
			{#each breakingShown as b (b.habitId)}
				{@const plan = b.ifThen}
				<li class="card">
					<div class="row">
						<div class="grow">
							<a class="name" href="/habits/{b.habitId}/chain"><strong>{b.name}</strong></a>
							<div class="big">
								{plural(b.days, b.limit?.period === 'week' ? 'week' : 'day')}{#if b.limit}{' '}<span class="muted small-text">within limit</span>{/if}
							</div>
							{#if b.limit}
								<div class="small-text" class:warn={b.limit.used > b.limit.max}>
									{b.limit.used} of {b.limit.max} {b.limit.period === 'week' ? 'this week' : 'today'}{#if b.limit.next}<span class="muted">
										· {b.limit.next.max} from {shortDate(b.limit.next.date)}</span
									>{/if}
								</div>
							{/if}
							<div class="muted small-text">
								{[
									b.limit ? null : `Longest run ${plural(b.longest, 'day')}`,
									b.slippedToday && !b.limit ? `${b.slippedToday} today` : null,
									b.resistedThisWeek ? `resisted ${b.resistedThisWeek}× this week` : null
								]
									.filter(Boolean)
									.join(' · ')}
							</div>
						</div>
						<form method="POST" action="?/craving" use:enhance={() => async ({ result, update }) => {
							await update();
							if (result.type === 'success' && result.data?.cravingId) {
								const id = String(result.data.cravingId);
								showToast(b.identities.length ? `Resisted. That's a vote for who you want to be.` : `Craving resisted. Nice.`, () => postAction('?/uncraving', { id }).then(() => {}));
							}
						}}>
							<input type="hidden" name="habit" value={b.habitId} />
							<button class="primary" title="Log a craving you didn't give in to" aria-label="Resisted: {b.name}">Resisted</button>
						</form>
						<button
							aria-expanded={slipOpen === b.habitId}
							aria-label="{b.limit ? 'Log one' : 'Slip'}: {b.name}"
							onclick={() => ((slipOpen = slipOpen === b.habitId ? null : b.habitId), (feeling = ''))}
							>{b.limit ? 'Log one' : 'Slip'}</button
						>
					</div>
					{#if plan && (plan.then || plan.habit) && !hidden('ifThen')}
						<p class="plan small-text">
							If I {plan.when || 'feel the urge'}, I will {[plan.then, plan.habit].filter(Boolean).join(' or ')}.
						</p>
					{/if}
					{#if b.reframe && !hidden('reframe')}<div class="reframe small-text">{b.reframe}</div>{/if}
					{#if b.cost && !hidden('cost')}
						<div class="muted small-text">
							Slips this month cost {fmt(b.cost.month)} {b.cost.unit}{b.cost.saved !== null
								? ` · saved ${fmt(b.cost.saved)} ${b.cost.unit} so far`
								: ''}
						</div>
					{/if}
					{#if form?.habit === b.habitId && form?.error}<p class="error small-text">{form.error}</p>{/if}
					{#if b.top.length}
						<div class="muted small-text">Most slips: {b.top.slice(0, 2).map(triggerLine).join(' · ')}</div>
					{/if}
					{#if b.identities.length && !hidden('identities')}
						<div class="votes small-text">Vote for: {b.identities.join(' · ')}</div>
					{/if}
					{#if slipOpen === b.habitId}
						<form
							method="POST"
							action="?/slip"
							class="stack slip"
							use:enhance={() =>
								async ({ result, update }) => {
									if (result.type === 'success') slipOpen = null;
									await update({ reset: false });
									if (result.type === 'success' && result.data?.slipped) {
										const sl = result.data.slipped as { id: string; habit: string };
										showToast(b.limit ? `Logged one for ${sl.habit}.` : `Slip logged for ${sl.habit}.`, () =>
											postAction('?/unslip', { id: sl.id }).then(() => {})
										);
									}
								}}
						>
							<input type="hidden" name="habit" value={b.habitId} />
							<div class="row">
								<label style="width: 5rem">Count <input name="count" type="number" min="1" max="1000" step="1" value="1" required /></label>
								<label class="grow"
									>Date <input name="date" type="date" value={data.today} min={b.startDate} max={data.today} required /></label
								>
								<label style="width: 7rem">Time <input name="time" type="time" value={nowTime()} /></label>
							</div>
							<div>
								<span class="muted small-text">How were you feeling? (optional)</span>
								<input type="hidden" name="feeling" value={feeling} />
								<div class="chips">
									{#each b.triggers as t (t.id)}
										<button type="button" class="chip" class:on={feeling === t.id} onclick={() => (feeling = feeling === t.id ? '' : t.id)}>{t.name}</button>
									{/each}
								</div>
							</div>
							<div class="row">
								<label class="grow">Where <input name="place" list="places-{b.habitId}" placeholder="optional" /></label>
								<label class="grow">With <input name="withWhom" placeholder="optional" /></label>
							</div>
							<datalist id="places-{b.habitId}">
								{#each b.places as p (p)}<option value={p}></option>{/each}
							</datalist>
							<button class="primary">{b.limit ? 'Log' : 'Log slip'}</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet prepSection()}
	{#if data.prep.length && !hidden('prep')}
		{#if !editing}<h2>Prepare for tomorrow</h2>{/if}
		<ul class="list">
			{#each data.prep as p (p.habitId)}
				<li class="card">
					<strong>{p.name}</strong>
					{#each p.items as it (it.item)}
						<form method="POST" action="?/prep" use:enhance>
							<input type="hidden" name="habit" value={p.habitId} />
							<input type="hidden" name="item" value={it.item} />
							<input type="hidden" name="done" value={String(!it.done)} />
							<button class="check" class:done={it.done} aria-pressed={it.done}>
								<span class="box" aria-hidden="true">{it.done ? '✓' : ''}</span>{it.item}
							</button>
						</form>
					{/each}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet pausedSection()}
	{#if data.paused.length}
		{#if !editing}<h2>Paused</h2>{/if}
		<ul class="list">
			{#each data.paused as item (item.habitId)}
				<li class="card row">
					<div class="grow">
						<strong>{item.name}</strong>
						<div class="muted small-text">Paused until {shortDate(item.pausedUntil!)}. Streak is safe.</div>
					</div>
					<a class="button small" href="/habits/{item.habitId}#pause">Change</a>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet restingSection()}
	{#if data.resting.length}
		{#if !editing}<h2>Not due today</h2>{/if}
		<ul class="list">
			{#each data.resting as item (item.habitId)}
				<li class="card row">
					<div class="grow">
						<strong>{item.name}</strong>
						{#if item.streak}<div class="muted small-text">{item.streak}</div>{/if}
					</div>
					{#if item.earlyVariant}
						<form method="POST" action="?/early" use:enhance>
							<input type="hidden" name="habit" value={item.habitId} />
							<input type="hidden" name="variant" value={item.earlyVariant.id} />
							<button class="small">Start {item.multiVariant ? item.earlyVariant.name : ''} early</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#if data.dayNote !== null}<DayNote date={data.today} text={data.dayNote} />{/if}

{#if form?.error && !form?.habit}<p class="error">{form.error}</p>{/if}

{#if celebrating}
	<button class="celebrate" onclick={() => (celebrating = null)} aria-live="polite">
		<span class="burst" aria-hidden="true">{#each Array(14) as _, i (i)}<i style="--i: {i}"></i>{/each}</span>
		<strong>{celebrating.name}</strong>
		<span>{celebrating.message}</span>
		{#if celebrating.jar}<span class="small-text">Jar: {celebrating.jar}</span>{/if}
	</button>
{/if}

<style>
	.widget {
		margin-bottom: 0.75rem;
	}
	/* Edit mode: each widget and section is a block with a title bar (see EditableList layout="block"). */
	.layout {
		margin-bottom: 0.75rem;
	}
	:global(.elist.block .widget) {
		margin-bottom: 0;
	}
	:global(.elist.sections) {
		margin-top: 0.75rem;
	}
	.headline-pick {
		margin-top: 0.5rem;
	}
	.widget progress {
		width: 100%;
	}
	progress.bar {
		display: block;
		width: 100%;
		max-width: 12rem;
		height: 0.4rem;
		margin-top: 0.25rem;
	}
	.week {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		text-align: center;
	}
	.week .day {
		display: flex;
		flex-direction: column;
	}
	.week .today {
		font-weight: 600;
	}
	.week a.day {
		color: inherit;
		text-decoration: none;
		border-radius: 6px;
	}
	.week a.day:hover {
		background: var(--border);
	}
	.nudge {
		align-items: center;
		margin-bottom: 0.75rem;
		border-color: var(--accent);
	}
	.week .full span:last-child {
		color: var(--accent);
	}
	.tpl {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	fieldset {
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.finished {
		opacity: 0.7;
	}
	/* The habits inside a group sit in its card, each faded on its own when finished. */
	.inside {
		margin-top: 0.6rem;
	}
	.stacked {
		margin-left: 1rem;
		border-left: 3px solid var(--border);
	}
	.next {
		border-left-color: var(--accent);
	}
	.small-text {
		font-size: 0.85rem;
	}
	.big {
		font-size: 1.6rem;
		font-weight: 600;
	}
	.chip {
		margin-left: 0.35rem;
	}
	.chips .chip {
		margin-left: 0;
	}
	.warn {
		color: var(--danger);
	}
	.levels {
		margin-top: 0.5rem;
		align-items: center;
	}
	.votes {
		margin-top: 0.4rem;
		color: var(--accent);
	}
	.plan {
		margin: 0.5rem 0 0;
		font-style: italic;
	}
	.slip {
		margin-top: 0.75rem;
	}
	a.name {
		color: inherit;
		text-decoration: none;
	}
	.grow,
	.card strong {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.reframe {
		font-style: italic;
		margin-top: 0.2rem;
	}
	.bundle {
		margin-top: 0.2rem;
	}
	.suggest {
		margin-top: 0.6rem;
		padding: 0.5rem 0.6rem;
		border: 1px dashed var(--accent);
		border-radius: 8px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		margin-top: 0.4rem;
		border: none;
		background: none;
		padding: 0.2rem 0;
		text-align: left;
	}
	.check .box {
		width: 1.2rem;
		height: 1.2rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		display: inline-grid;
		place-items: center;
		font-size: 0.8rem;
		color: var(--accent);
	}
	.check.done {
		color: var(--muted);
		text-decoration: line-through;
	}
	.celebrate {
		position: fixed;
		left: 1rem;
		right: 1rem;
		bottom: 5rem;
		max-width: 608px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 1rem;
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--accent-text);
		border: none;
		text-align: left;
		animation: pop 0.25s ease-out;
	}
	.burst {
		position: absolute;
		top: 0;
		left: 50%;
		pointer-events: none;
	}
	.burst i {
		position: absolute;
		width: 6px;
		height: 10px;
		border-radius: 2px;
		background: hsl(calc(var(--i) * 26deg) 85% 60%);
		animation: fly 1.1s ease-out forwards;
		transform: rotate(calc(var(--i) * 25.7deg)) translateY(0);
	}
	@keyframes fly {
		to {
			transform: rotate(calc(var(--i) * 25.7deg)) translateY(-90px);
			opacity: 0;
		}
	}
	@keyframes pop {
		from {
			transform: translateY(12px);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.burst {
			display: none;
		}
		.celebrate {
			animation: none;
		}
	}
	.ask {
		margin-bottom: 1rem;
		border-color: var(--accent);
	}
	.range {
		margin-top: 0.35rem;
		align-items: center;
	}
	h2.area {
		border-left: 4px solid var(--area);
		padding-left: 0.5rem;
	}
</style>
