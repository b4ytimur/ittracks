<script lang="ts">
	import { enhance } from '$app/forms';
	import { queueable } from '$lib/queueable';
	import { postAction, showToast } from '$lib/toast.svelte';
	import type { ActionResult } from '@sveltejs/kit';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { outbox } from '$lib/outbox.svelte';

	let { data, form } = $props();
	let slipOpen = $state<string | null>(null);
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
		const item = data.build.find((b) => b.occurrence?.id === id);
		if (item) showToast(`Logged ${item.name}.`, () => postAction('?/undo', { occurrence: id, clear: clear ? '1' : '' }).then(() => {}));
		const u = new URL(page.url);
		u.searchParams.delete('did');
		u.searchParams.delete('clear');
		replaceState(u, {});
	});

	type Did = { occurrence: string; habit: string; clear: boolean; skipped?: boolean };
	/** After a quick action: say what happened and offer Undo. */
	function afterDid(result: ActionResult) {
		if (result.type !== 'success') return;
		const did = result.data?.did as Did | undefined;
		if (!did) return;
		showToast(`${did.skipped ? 'Skipped' : 'Logged'} ${did.habit}.`, () =>
			postAction('?/undo', { occurrence: did.occurrence, clear: did.clear ? '1' : '' }).then(() => {})
		);
	}
	const quick = (occurrenceId: string, name: string, kind: 'done' | 'skipped' = 'done') =>
		queueable(`${name}`, {
			onQueued: () => {
				pending[occurrenceId] = kind;
				showToast(`${kind === 'skipped' ? 'Skipped' : 'Logged'} ${name}. It will sync when you're back online.`);
			},
			after: afterDid
		});

	// The one-time day question.
	let dayStart = $state('04:00');
	let ranges = $state(untrack(() => data.suggestedRanges.map((r) => ({ ...r }))));

	/** Build items, grouped by Area when the user asked for that. */
	const groups = $derived.by(() => {
		if (!data.groupByArea) return [{ key: 'all', area: null, items: data.build }];
		const byArea = new Map<string, typeof data.build>();
		for (const b of data.build) {
			const k = b.areaId && data.areas.some((a) => a.id === b.areaId) ? b.areaId : '';
			byArea.set(k, [...(byArea.get(k) ?? []), b]);
		}
		return [...data.areas.map((a) => a.id), '']
			.filter((k) => byArea.has(k))
			.map((k) => ({ key: k || 'none', area: data.areas.find((a) => a.id === k) ?? null, items: byArea.get(k)! }));
	});

	const dateLabel = $derived(
		new Date(data.today + 'T12:00:00').toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const nowTime = () => new Date().toTimeString().slice(0, 5);
	const levelName = { minimum: 'Minimum', target: 'Target', stretch: 'Stretch' } as const;

	type Item = (typeof data.build)[number];
	const cueLine = (c: Item['cue']) =>
		[c.after ? `after ${c.after}` : null, c.time ?? c.range, c.place].filter(Boolean).join(' · ');
	const shortDate = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	const triggerLine = (t: { kind: string; label: string; percent: number }) =>
		t.kind === 'feeling'
			? `${t.percent}% when ${t.label}`
			: t.kind === 'place'
				? `${t.percent}% at ${t.label}`
				: t.kind === 'with'
					? `${t.percent}% with ${t.label}`
					: `${t.percent}% ${t.label}`;
</script>

<svelte:head><title>Today · ittracks</title></svelte:head>

<header class="bar">
	<div>
		<h1>Today</h1>
		<div class="muted">{dateLabel}</div>
	</div>
	<a href="/identities">Identities</a>
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
				<div class="row range">
					<input class="grow" name="rangeName" bind:value={r.name} aria-label="Name" />
					<input type="time" name="rangeStart" bind:value={r.start} aria-label="{r.name} starts" style="width: 7rem" />
					<input type="time" name="rangeEnd" bind:value={r.end} aria-label="{r.name} ends" style="width: 7rem" />
					<button type="button" class="small" onclick={() => ranges.splice(i, 1)} aria-label="Remove {r.name}">×</button>
				</div>
			{/each}
			<button type="button" class="small" onclick={() => ranges.push({ name: '', start: '12:00', end: '13:00' })}>+ part</button>
		</div>
		<div class="row">
			<button class="primary">Save</button>
			<span class="muted small-text grow">You can change this any time in Settings.</span>
		</div>
	</form>
{/if}

{#if !data.build.length && !data.resting.length && !data.breaking.length && !data.paused.length}
	<p class="muted">Nothing here yet. <a href="/habits/new">Create a habit</a> or <a href="/gallery">pick a ready-made one</a>.</p>
{/if}

{#each groups as g (g.key)}
	{#if data.groupByArea}
		<h2 class="area" style="--area: {g.area?.color ?? 'var(--border)'}">{g.area ? `${g.area.icon} ${g.area.name}`.trim() : 'No area'}</h2>
	{/if}
	<ul class="list">
		{#each g.items as item (item.habitId)}
			{@const o = item.occurrence!}
			{@const st = statusOf(o)}
			{@const levels = item.levels}
			<li class="card" class:finished={st !== 'due'} class:stacked={!!item.afterHabitId} class:next={item.upNext}>
				<div class="row">
					<div class="grow">
						<strong>{item.name}</strong>
						{#if item.multiVariant && o.variantName}<span class="chip">{o.variantName}</span>{/if}
						{#if item.upNext}<span class="chip on">Up next</span>{/if}
						{#if item.inProgress && st === 'due'}<span class="chip on">In progress</span>{/if}
						{#if cueLine(item.cue)}<div class="muted small-text">{cueLine(item.cue)}</div>{/if}
						<div class="muted small-text">
							{#if st === 'done'}Done{#if levels}&nbsp;at {levelName[o.level ?? 'target']}{/if}{:else if st === 'skipped'}Skipped{:else}Due{/if}
							{#if item.streak}· {item.streak}{/if}
						</div>
						{#if item.atRisk && st === 'due'}
							<div class="warn small-text">You missed last time. Don't miss twice{levels ? ': even the Minimum counts' : ''}.</div>
						{/if}
						{#if levels && st === 'due' && levels.minimum}
							<div class="muted small-text">Minimum: {levels.minimum}</div>
						{/if}
					</div>
					{#if st === 'due'}
						{#if o.slotCount > 0}
							{#if item.inProgress}
								<a class="button primary" href="/log/{o.id}">Resume</a>
							{:else}
								<a class="button" class:primary={!item.canRepeat && !item.quickDone} href="/log/{o.id}">Log</a>
								{#if item.canRepeat}
									<form method="POST" action="?/same" use:enhance={quick(o.id, item.name)}>
										<input type="hidden" name="occurrence" value={o.id} />
										<button class="primary" title="Copy your last log and finish">Same as last</button>
									</form>
								{:else if item.quickDone}
									<form method="POST" action="?/quick" use:enhance={quick(o.id, item.name)}>
										<input type="hidden" name="occurrence" value={o.id} />
										<button class="primary" title="Log your targets">Done</button>
									</form>
								{/if}
							{/if}
						{:else}
							<form method="POST" action="?/done" use:enhance={quick(o.id, item.name)}>
								<input type="hidden" name="occurrence" value={o.id} />
								<button class="primary">Done</button>
							</form>
						{/if}
						<form method="POST" action="?/skip" use:enhance={quick(o.id, item.name, 'skipped')}>
							<input type="hidden" name="occurrence" value={o.id} />
							<button>Skip</button>
						</form>
					{:else if !pending[o.id]}
						{#if o.slotCount > 0}<a class="button" href="/log/{o.id}">View</a>{/if}
						<form method="POST" action="?/undo" use:enhance>
							<input type="hidden" name="occurrence" value={o.id} />
							<button class="link">Undo</button>
						</form>
					{/if}
				</div>
				{#if levels && st === 'due' && !item.inProgress && (o.slotCount === 0 || item.quickDone || item.canRepeat)}
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
				{#if item.identities.length}
					<div class="votes small-text">Vote for: {item.identities.join(' · ')}</div>
				{/if}
			</li>
		{/each}
	</ul>
{/each}

{#if data.breaking.length}
	<h2>Breaking</h2>
	<ul class="list">
		{#each data.breaking as b (b.habitId)}
			{@const plan = b.ifThen}
			<li class="card">
				<div class="row">
					<div class="grow">
						<strong>{b.name}</strong>
						<div class="big">{plural(b.days, 'day')}</div>
						<div class="muted small-text">
							Longest run {plural(b.longest, 'day')}{b.slippedToday ? ` · ${b.slippedToday} today` : ''}{b.resistedThisWeek
								? ` · resisted ${b.resistedThisWeek}× this week`
								: ''}
						</div>
					</div>
					<form method="POST" action="?/craving" use:enhance={() => async ({ result, update }) => {
						await update();
						if (result.type === 'success' && result.data?.cravingId) {
							const id = String(result.data.cravingId);
							showToast(`Resisted. That's a vote for who you want to be.`, () => postAction('?/uncraving', { id }).then(() => {}));
						}
					}}>
						<input type="hidden" name="habit" value={b.habitId} />
						<button class="primary" title="Log a craving you didn't give in to">Resisted</button>
					</form>
					<button onclick={() => ((slipOpen = slipOpen === b.habitId ? null : b.habitId), (feeling = ''))}>Slip</button>
				</div>
				{#if plan && (plan.then || plan.habit)}
					<p class="plan small-text">
						If I {plan.when || 'feel the urge'}, I will {[plan.then, plan.habit].filter(Boolean).join(' or ')}.
					</p>
				{/if}
				{#if b.top.length}
					<div class="muted small-text">Most slips: {b.top.slice(0, 2).map(triggerLine).join(' · ')}</div>
				{/if}
				{#if b.identities.length}
					<div class="votes small-text">Vote for: {b.identities.join(' · ')}</div>
				{/if}
				{#if slipOpen === b.habitId}
					<form
						method="POST"
						action="?/slip"
						class="stack slip"
						use:enhance={() =>
							async ({ result, update }) => {
								slipOpen = null;
								await update();
								if (result.type === 'success' && result.data?.slipped) {
									const sl = result.data.slipped as { id: string; habit: string };
									showToast(`Slip logged for ${sl.habit}.`, () => postAction('?/unslip', { id: sl.id }).then(() => {}));
								}
							}}
					>
						<input type="hidden" name="habit" value={b.habitId} />
						<div class="row">
							<label style="width: 5rem">Count <input name="count" type="number" min="1" step="1" value="1" /></label>
							<label class="grow">Date <input name="date" type="date" value={data.today} max={data.today} /></label>
							<label style="width: 7rem">Time <input name="time" type="time" value={nowTime()} /></label>
						</div>
						<div>
							<span class="muted small-text">How were you feeling? (optional)</span>
							<input type="hidden" name="feeling" value={feeling} />
							<div class="chips">
								{#each b.triggers as t (t)}
									<button type="button" class="chip" class:on={feeling === t} onclick={() => (feeling = feeling === t ? '' : t)}>{t}</button>
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
						<button class="primary">Log slip</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if data.paused.length}
	<h2>Paused</h2>
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

{#if data.resting.length}
	<h2>Not due today</h2>
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

{#if form?.error}<p class="error">{form.error}</p>{/if}

<style>
	.finished {
		opacity: 0.7;
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
