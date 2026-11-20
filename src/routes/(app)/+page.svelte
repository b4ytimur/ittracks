<script lang="ts">
	import { enhance } from '$app/forms';

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
			message: item.reward.message || 'Done. Another vote for who you want to be.',
			jar: jar ? `${fmt(jar.total)} ${jar.unit}${jar.goal ? ` toward ${jar.goal}` : ''}` : null
		};
		if (data.finished) history.replaceState(history.state, '', '/');
		const t = setTimeout(() => (celebrating = null), 4500);
		return () => clearTimeout(t);
	});
	let feeling = $state('');

	const dateLabel = $derived(
		new Date(data.today + 'T12:00:00').toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));
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
						<a class="name" href="/habits/{item.habitId}/chain"><strong>{item.name}</strong></a>
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
				{#if item.progression}
					{@const p = item.progression}
					<div class="suggest">
						<span class="small-text"
							>You've hit your targets {p.hits} times in a row. Raise them by {p.by}{p.unit === 'percent' ? '%' : ''}?</span
						>
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
{/if}

{#if data.breaking.length}
	<h2>Breaking</h2>
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
								{b.limit.used} of {b.limit.max} {b.limit.period === 'week' ? 'this week' : 'today'}
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
				{#if b.reframe}<div class="reframe small-text">{b.reframe}</div>{/if}
				{#if b.cost}
					<div class="muted small-text">
						Slips this month cost {fmt(b.cost.month)} {b.cost.unit}{b.cost.saved !== null
							? ` · saved ${fmt(b.cost.saved)} ${b.cost.unit} so far`
							: ''}
					</div>
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
</style>
