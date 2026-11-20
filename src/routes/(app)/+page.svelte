<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let slipOpen = $state<string | null>(null);
	let feeling = $state('');

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
		[c.after ? `after ${c.after}` : null, c.time, c.place].filter(Boolean).join(' · ');
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

{#if !data.build.length && !data.resting.length && !data.breaking.length}
	<p class="muted">Nothing here yet. <a href="/habits/new">Create a habit</a> to get started.</p>
{/if}

{#if data.build.length}
	<ul class="list">
		{#each data.build as item (item.habitId)}
			{@const o = item.occurrence!}
			{@const levels = item.levels}
			<li class="card" class:finished={o.status !== 'due'} class:stacked={!!item.afterHabitId} class:next={item.upNext}>
				<div class="row">
					<div class="grow">
						<strong>{item.name}</strong>
						{#if item.multiVariant && o.variantName}<span class="chip">{o.variantName}</span>{/if}
						{#if item.upNext}<span class="chip on">Up next</span>{/if}
						{#if cueLine(item.cue)}<div class="muted small-text">{cueLine(item.cue)}</div>{/if}
						<div class="muted small-text">
							{#if o.status === 'done'}Done{#if levels}&nbsp;at {levelName[o.level ?? 'target']}{/if}{:else if o.status === 'skipped'}Skipped{:else}Due{/if}
							{#if item.streak}· {item.streak}{/if}
						</div>
						{#if item.atRisk && o.status === 'due'}
							<div class="warn small-text">You missed last time. Don't miss twice{levels ? ': even the Minimum counts' : ''}.</div>
						{/if}
						{#if levels && o.status === 'due' && levels.minimum}
							<div class="muted small-text">Minimum: {levels.minimum}</div>
						{/if}
					</div>
					{#if o.status === 'due'}
						{#if o.slotCount > 0}
							<a class="button" class:primary={!item.quickDone} href="/log/{o.id}">Start</a>
							{#if item.quickDone}
								<form method="POST" action="?/quick" use:enhance>
									<input type="hidden" name="occurrence" value={o.id} />
									<button class="primary" title="Log your targets">Done</button>
								</form>
							{/if}
						{:else}
							<form method="POST" action="?/done" use:enhance>
								<input type="hidden" name="occurrence" value={o.id} />
								<button class="primary">Done</button>
							</form>
						{/if}
						<form method="POST" action="?/skip" use:enhance>
							<input type="hidden" name="occurrence" value={o.id} />
							<button>Skip</button>
						</form>
					{:else}
						{#if o.slotCount > 0}<a class="button" href="/log/{o.id}">View</a>{/if}
						<form method="POST" action="?/undo" use:enhance>
							<input type="hidden" name="occurrence" value={o.id} />
							<button class="link">Undo</button>
						</form>
					{/if}
				</div>
				{#if levels && o.status === 'due' && (o.slotCount === 0 || item.quickDone)}
					<div class="row levels">
						<span class="muted small-text">Or log</span>
						{#each ['minimum', 'stretch'] as const as l (l)}
							<form method="POST" action={o.slotCount ? '?/quick' : '?/done'} use:enhance>
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
{/if}

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
					<form method="POST" action="?/craving" use:enhance>
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
				{#if form?.resisted === b.habitId}<p class="muted small-text">Nice. That's a vote for who you want to be.</p>{/if}
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
							async ({ update }) => {
								slipOpen = null;
								await update();
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
</style>
