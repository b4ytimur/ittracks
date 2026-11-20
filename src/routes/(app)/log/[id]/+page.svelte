<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import Timer from './Timer.svelte';

	let { data, form } = $props();

	type Values = Record<string, unknown>;
	interface ItemState {
		sets: { done: boolean; values: Values }[];
		summary: Values;
		subs: Record<string, boolean>;
	}

	const isSummary = (v: Values) => v._summary === true;

	/** Build the editable state for each Slot: saved values, or a prefill from last time. */
	function initial(): ItemState[] {
		return data.items.map((it) => {
			const t = it.task;
			if (!t) return { sets: [], summary: {}, subs: {} };
			const repeating = t.metrics.filter((m) => m.repeats);
			const subs = Object.fromEntries(t.subtasks.map((s) => [s.id, !!data.subDone[s.id]]));
			const savedSets = it.saved.filter((v) => !isSummary(v));
			const savedSummary = it.saved.find(isSummary) ?? {};
			if (it.saved.length) {
				return {
					sets: savedSets.map((values) => ({ done: true, values: { ...values } })),
					summary: { ...savedSummary },
					subs
				};
			}
			const prev = it.previous.filter((v) => !isSummary(v));
			const count = repeating.length ? (it.sets ?? (prev.length || 1)) : 0;
			const fromTargets = Object.fromEntries(
				repeating.filter((m) => it.targets[m.id] !== undefined).map((m) => [m.id, it.targets[m.id]])
			);
			return {
				sets: Array.from({ length: count }, (_, i) => ({
					done: false,
					values: { ...fromTargets, ...(prev[i] ?? prev.at(-1) ?? {}) }
				})),
				summary: {},
				subs
			};
		});
	}

	let log = $state<ItemState[]>(untrack(initial));
	let notes = $state(untrack(() => data.occurrence.notes));
	let restEnd = $state<number | null>(null);
	let now = $state(Date.now());

	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(t);
	});
	const restLeft = $derived(restEnd ? Math.max(0, Math.ceil((restEnd - now) / 1000)) : null);
	$effect(() => {
		if (restLeft === 0) navigator.vibrate?.(300);
	});

	function payload(finish: boolean) {
		const entries: { taskId: string; values: Values }[] = [];
		data.items.forEach((it, i) => {
			const t = it.task;
			if (!t) return;
			const s = log[i];
			const repeatingIds = t.metrics.filter((m) => m.repeats).map((m) => m.id);
			for (const set of s.sets.filter((x) => x.done)) {
				entries.push({
					taskId: t.id,
					values: Object.fromEntries(repeatingIds.map((id) => [id, set.values[id] ?? null]))
				});
			}
			const filled = Object.entries(s.summary).filter(([, v]) => v !== '' && v !== null && v !== undefined);
			if (filled.length) entries.push({ taskId: t.id, values: { ...Object.fromEntries(filled), _summary: true } });
			for (const [subId, done] of Object.entries(s.subs)) {
				if (done) entries.push({ taskId: subId, values: { done: true } });
			}
		});
		return JSON.stringify({ finish, notes, entries });
	}

	function setDone(i: number, j: number, done: boolean) {
		log[i].sets[j].done = done;
		const t = data.items[i].task;
		if (done && t?.restTimerEnabled) restEnd = Date.now() + t.restTimerSeconds * 1000;
	}

	function addSet(i: number) {
		const last = log[i].sets.at(-1);
		log[i].sets.push({ done: false, values: { ...(last?.values ?? {}) } });
	}

	const dateLabel = $derived(
		new Date(data.occurrence.date + 'T12:00:00').toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		})
	);

	const prevSummary = (i: number) => data.items[i].previous.find(isSummary) ?? {};
	const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v));
	const toNum = (s: string) => (s === '' ? null : Number(s));
</script>

<svelte:head><title>{data.habitName} · ittracks</title></svelte:head>

<header class="bar">
	<div>
		<h1>{data.habitName}</h1>
		<div class="muted">
			{[data.variantName, dateLabel, data.occurrence.status !== 'due' ? data.occurrence.status : null]
				.filter(Boolean)
				.join(' · ')}
		</div>
	</div>
	<a href="/">Back</a>
</header>

{#each data.items as it, i (it.slotId)}
	{@const t = it.task}
	<section class="card stack">
		<div class="row">
			<h2 class="grow" style="margin: 0">{t?.name ?? 'No matching Task'}</h2>
			{#if it.open}
				<form method="POST" action="?/reroll" use:enhance={() => async ({ update }) => { await update(); log[i] = initial()[i]; }}>
					<input type="hidden" name="slot" value={it.slotId} />
					<button class="small" title="Pick another Task">Reroll</button>
				</form>
			{/if}
			<details class="swap">
				<summary class="small-text">Swap</summary>
				<form method="POST" action="?/swap" class="row" use:enhance={() => async ({ update }) => { await update(); log[i] = initial()[i]; }}>
					<input type="hidden" name="slot" value={it.slotId} />
					<select name="task" aria-label="Task to use">
						{#each data.library as l (l.id)}<option value={l.id} selected={l.id === t?.id}>{l.name}</option>{/each}
					</select>
					<button class="small">Use</button>
				</form>
			</details>
		</div>
		{#if it.open && !t}
			<p class="muted">No Task in your Library matches this slot's rules. <a href="/library">Open the Library</a>.</p>
		{/if}

		{#if t}
			{@const repeating = t.metrics.filter((m) => m.repeats)}
			{@const single = t.metrics.filter((m) => !m.repeats)}

			{#if repeating.length}
				<table class="sets">
					<thead>
						<tr>
							<th>Set</th>
							{#each repeating as m (m.id)}<th>{m.name}{m.unit ? ` (${m.unit})` : ''}</th>{/each}
							<th>Done</th>
						</tr>
					</thead>
					<tbody>
						{#each log[i].sets as set, j (j)}
							<tr class:done={set.done}>
								<td>{j + 1}</td>
								{#each repeating as m (m.id)}
									<td>
										{#if m.type === 'checkbox'}
											<input type="checkbox" checked={!!set.values[m.id]} onchange={(e) => (set.values[m.id] = e.currentTarget.checked)} />
										{:else if m.type === 'choice'}
											<select value={num(set.values[m.id])} onchange={(e) => (set.values[m.id] = e.currentTarget.value)}>
												<option value=""></option>
												{#each m.choices ?? [] as c (c)}<option>{c}</option>{/each}
											</select>
										{:else if m.type === 'text'}
											<input value={num(set.values[m.id])} oninput={(e) => (set.values[m.id] = e.currentTarget.value)} />
										{:else}
											<input type="number" inputmode="decimal" step="any" value={num(set.values[m.id])}
												oninput={(e) => (set.values[m.id] = toNum(e.currentTarget.value))} aria-label="{m.name}, set {j + 1}" />
										{/if}
									</td>
								{/each}
								<td><input type="checkbox" checked={set.done} onchange={(e) => setDone(i, j, e.currentTarget.checked)} aria-label="Set {j + 1} done" /></td>
							</tr>
						{/each}
					</tbody>
				</table>
				<div class="row">
					<button type="button" class="small" onclick={() => addSet(i)}>+ set</button>
					{#if log[i].sets.length}
						<button type="button" class="small" onclick={() => log[i].sets.pop()}>− set</button>
					{/if}
					{#if it.sets}<span class="muted small-text">Target {it.sets} sets</span>{/if}
				</div>
			{/if}

			{#each single as m (m.id)}
				{@const prev = prevSummary(i)[m.id]}
				<div>
					{#if m.type === 'checkbox'}
						<label style="color: var(--text)"
							><input type="checkbox" checked={!!log[i].summary[m.id]} onchange={(e) => (log[i].summary[m.id] = e.currentTarget.checked)} />
							{m.name}</label
						>
					{:else if m.type === 'choice'}
						<label>{m.name}
							<select value={num(log[i].summary[m.id])} onchange={(e) => (log[i].summary[m.id] = e.currentTarget.value)}>
								<option value=""></option>
								{#each m.choices ?? [] as c (c)}<option>{c}</option>{/each}
							</select>
						</label>
					{:else if m.type === 'text'}
						<label>{m.name} <input value={num(log[i].summary[m.id])} oninput={(e) => (log[i].summary[m.id] = e.currentTarget.value)} /></label>
					{:else}
						<label>
							{m.name}{m.unit ? ` (${m.unit})` : m.type === 'duration' ? ' (min)' : ''}
							{#if it.targets[m.id] !== undefined}<span class="small-text">· target {it.targets[m.id]}</span>{/if}
							<input type="number" inputmode="decimal" step="any" value={num(log[i].summary[m.id])}
								placeholder={prev !== undefined ? `last time ${prev}` : ''}
								oninput={(e) => (log[i].summary[m.id] = toNum(e.currentTarget.value))} />
						</label>
						{#if m.type === 'duration'}
							<Timer
								bind:value={() => log[i].summary[m.id] as number | null, (v) => (log[i].summary[m.id] = v)}
								target={it.targets[m.id] ?? null}
								storageKey="timer:{data.occurrence.id}:{m.id}"
							/>
						{/if}
					{/if}
				</div>
			{/each}

			{#if t.subtasks.length}
				<div>
					{#each t.subtasks as s (s.id)}
						<label style="color: var(--text)"><input type="checkbox" bind:checked={log[i].subs[s.id]} /> {s.name}</label>
					{/each}
				</div>
			{/if}
		{/if}
	</section>
{/each}

{#if data.items.length === 0}
	<p class="muted">This habit has nothing to log. Add Tasks to it in the Habit editor, or mark it done from Today.</p>
{/if}

<label style="margin-top: 1rem">Notes <textarea bind:value={notes} rows="2"></textarea></label>

{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.saved}<p class="muted">Saved.</p>{/if}

<div class="actions">
	<form method="POST" action="?/save" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<input type="hidden" name="payload" value={payload(true)} />
		<button class="primary">{data.occurrence.status === 'done' ? 'Save changes' : 'Finish'}</button>
	</form>
	{#if data.occurrence.status !== 'done'}
		<form method="POST" action="?/save" use:enhance={() => async ({ update }) => update({ reset: false })}>
			<input type="hidden" name="payload" value={payload(false)} />
			<button>Save for later</button>
		</form>
	{/if}
</div>

{#if restLeft !== null}
	<div style="height: 4rem" aria-hidden="true"></div>
	<div class="rest" role="status">
		{#if restLeft > 0}
			Rest {Math.floor(restLeft / 60)}:{String(restLeft % 60).padStart(2, '0')}
		{:else}
			Rest over, next set
		{/if}
		<button class="small" onclick={() => (restEnd = null)}>Dismiss</button>
	</div>
{/if}

<style>
	.sets {
		width: 100%;
		border-collapse: collapse;
	}
	.sets th {
		text-align: left;
		font-size: 0.8rem;
		color: var(--muted);
		font-weight: 500;
		padding: 0 0.25rem 0.25rem;
	}
	.sets td {
		padding: 0.2rem 0.25rem;
	}
	.sets td:first-child {
		color: var(--muted);
		width: 2rem;
	}
	.sets tr.done input[type='number'] {
		border-color: var(--accent);
	}
	.small-text {
		font-size: 0.85rem;
	}
	.swap summary {
		cursor: pointer;
		color: var(--accent);
	}
	.swap[open] {
		flex-basis: 100%;
	}
	.rest {
		position: fixed;
		left: 1rem;
		right: 1rem;
		bottom: 4.5rem;
		max-width: 608px;
		margin: 0 auto;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.rest button {
		color: var(--text);
	}
</style>
