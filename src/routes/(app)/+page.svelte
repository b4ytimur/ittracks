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
				<div class="range">
					<input class="grow" name="rangeName" bind:value={r.name} aria-label="Name" />
					<input type="time" name="rangeStart" bind:value={r.start} aria-label="{r.name} starts" />
					<input type="time" name="rangeEnd" bind:value={r.end} aria-label="{r.name} ends" />
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
						<a class="name" href="/habits/{item.habitId}/chain"><strong>{item.name}</strong></a>
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
						{#if item.reframe}<div class="reframe small-text">{item.reframe}</div>{/if}
						{#if item.bundle}
							<div class="small-text bundle">
								{#if item.bundle.strict}
									{o.status === 'done' ? `Earned: ${item.bundle.reward}` : `After this: ${item.bundle.reward}`}
								{:else}
									Pair with: {item.bundle.reward}
								{/if}
							</div>
						{/if}
						{#if item.reward?.jar}
							<div class="muted small-text">
								Jar: {fmt(item.reward.jar.total)} {item.reward.jar.unit}{item.reward.jar.goal ? ` toward ${item.reward.jar.goal}` : ''}
							</div>
						{/if}
					</div>
					{#if st === 'due'}
						{#if o.slotCount > 0}
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
				{#if item.progression}
					{@const p = item.progression}
					<div class="suggest">
						<span class="small-text"
							>You've hit your targets {p.hits} times in a row. Raise them by {p.by}{p.unit === 'percent' ? '%' : ''}?</span
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
				{#if item.identities.length}
					<div class="votes small-text">Vote for: {item.identities.join(' · ')}</div>
				{/if}
			</li>
		{/each}
	</ul>
{/each}

{#if data.breaking.length}
	<h2>{limiting ? 'Breaking and limiting' : 'Breaking'}</h2>
	<ul class="list">
		{#each data.breaking as b (b.habitId)}
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
				{#if plan && (plan.then || plan.habit)}
					<p class="plan small-text">
						If I {plan.when || 'feel the urge'}, I will {[plan.then, plan.habit].filter(Boolean).join(' or ')}.
					</p>
				{/if}
				{#if b.reframe}<div class="reframe small-text">{b.reframe}</div>{/if}
				{#if b.cost}
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
						<button class="primary">{b.limit ? 'Log' : 'Log slip'}</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if data.prep.length}
	<h2>Prepare for tomorrow</h2>
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
