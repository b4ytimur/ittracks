<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import Timer from './Timer.svelte';
	import Stepper from './Stepper.svelte';
	import { defaultStep } from '$lib/task-types';
	import { enqueue, isOffline } from '$lib/outbox.svelte';
	import { postAction, showToast } from '$lib/toast.svelte';

	let { data, form } = $props();

	type Values = Record<string, unknown>;
	interface ItemState {
		sets: { done: boolean; values: Values }[];
		summary: Values;
		subs: Record<string, boolean>;
	}
	type Item = (typeof data.items)[number];
	type Metric = NonNullable<Item['task']>['metrics'][number];

	const isSummary = (v: Values) => v._summary === true;
	/** Quick log (from a shortcut or link): only the fields marked for quick logs. */
	const quickMode = $derived(page.url.searchParams.has('quick'));
	/** Not finished yet: due today, or a past day that was missed, skipped or never logged. */
	const isOpen = $derived(data.occurrence.status !== 'done' && data.canLog);

	/**
	 * Where a field's starting value comes from, per its log setting. A tick box always
	 * starts unticked: a tick says you did it this time, so it is never copied.
	 */
	function prefillValue(m: Metric, it: Item, last: unknown): unknown {
		const target = it.targets[m.id];
		if (m.prefill === 'blank' || m.type === 'checkbox') return undefined;
		if (m.prefill === 'target') return target ?? last;
		return last ?? target;
	}

	/** The planned sets and values for a Slot, before anything is logged: a prefill from last time. */
	function planned(it: Item): ItemState {
		const t = it.task;
		if (!t) return { sets: [], summary: {}, subs: {} };
		const repeating = t.metrics.filter((m) => m.repeats);
		const single = t.metrics.filter((m) => !m.repeats);
		const prev = it.previous.filter((v) => !isSummary(v));
		const prevSummary = it.previous.find(isSummary) ?? {};
		const count = repeating.length ? (it.sets ?? (prev.length || 1)) : 0;
		const sets = Array.from({ length: count }, (_, i) => ({
			done: false,
			values: Object.fromEntries(
				repeating
					.map((m) => [m.id, prefillValue(m, it, (prev[i] ?? prev.at(-1))?.[m.id])] as const)
					.filter(([, v]) => v !== undefined)
			) as Values
		}));
		const summary = Object.fromEntries(
			single.map((m) => [m.id, prefillValue(m, it, prevSummary[m.id])] as const).filter(([, v]) => v !== undefined)
		) as Values;
		// Sub-tasks start unticked too: you tick the ones you did.
		const subs = Object.fromEntries(t.subtasks.map((s) => [s.id, false]));
		return { sets, summary, subs };
	}

	/**
	 * Build the editable state for each Slot. A finished log shows what was saved. A log
	 * that is still due shows the saved (ticked) sets first, then the planned sets not
	 * logged yet, so leaving half way through a workout loses nothing.
	 */
	function initial(): ItemState[] {
		return data.items.map((it) => {
			const t = it.task;
			if (!t) return { sets: [], summary: {}, subs: {} };
			const savedSets = it.saved.filter((v) => !isSummary(v));
			const savedSummary = it.saved.find(isSummary) ?? {};
			// Not finished: due today, or a past day that was missed, skipped or never logged.
			const due = data.occurrence.status !== 'done';
			if (due && !it.saved.length) return planned(it);
			const sets = savedSets.map((values) => ({ done: true, values: { ...values } }));
			if (due) sets.push(...planned(it).sets.slice(sets.length));
			return {
				sets,
				summary: { ...savedSummary },
				subs: Object.fromEntries(t.subtasks.map((s) => [s.id, !!data.subDone[s.id]]))
			};
		});
	}

	const DRAFT = untrack(() => `log-draft:${data.occurrence.id}`);
	interface Draft {
		log: ItemState[];
		notes: string;
		level: 'minimum' | 'target' | 'stretch';
		synced: boolean;
	}
	const readDraft = (): Draft | null => {
		try {
			return JSON.parse(localStorage.getItem(DRAFT) ?? 'null');
		} catch {
			return null;
		}
	};

	let log = $state<ItemState[]>(untrack(initial));
	/** The prefill, to show which values differ from it. */
	let base = $state.raw<ItemState[]>(untrack(() => structuredClone($state.snapshot(log))));
	let notes = $state(untrack(() => data.occurrence.notes));
	let level = $state<'minimum' | 'target' | 'stretch'>(untrack(() => data.occurrence.level));
	let problem = $state('');
	const levelNames = { minimum: 'Minimum', target: 'Target', stretch: 'Stretch' } as const;
	/** The target for a Metric at the chosen level, falling back to Target. */
	const targetAt = (it: (typeof data.items)[number], id: string) =>
		(level === 'minimum' ? it.minTargets[id] : level === 'stretch' ? it.stretchTargets[id] : undefined) ??
		it.targets[id];
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

	// ----- Autosave: every change is kept on this device at once, and on the server shortly after -----
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saveState = $state<'idle' | 'saving' | 'saved' | 'local'>('idle');
	const snapshot = $derived(JSON.stringify({ log, notes, level }));
	let primed = false;

	onMount(() => {
		// Restore work that never reached the server (a reload while offline, a crash).
		const d = readDraft();
		if (d && !d.synced && data.occurrence.status !== 'done' && d.log.length === log.length) {
			log = d.log;
			notes = d.notes;
			level = d.level;
		}
		return () => clearTimeout(saveTimer);
	});

	$effect(() => {
		void snapshot;
		if (!primed) {
			primed = true;
			return;
		}
		untrack(() => {
			if (!isOpen) return;
			writeDraft(false);
			// A past day is saved on Finish only, so leaving it half done doesn't leave a partial log.
			if (data.past) return;
			clearTimeout(saveTimer);
			saveTimer = setTimeout(autosave, 1500);
		});
	});

	function writeDraft(synced: boolean) {
		try {
			localStorage.setItem(DRAFT, JSON.stringify({ log: $state.snapshot(log), notes, level, synced }));
		} catch {
			/* storage blocked */
		}
	}
	const clearDraft = () => {
		try {
			localStorage.removeItem(DRAFT);
		} catch {
			/* storage blocked */
		}
	};
	const saveUrl = () => `/log/${data.occurrence.id}?/save`;

	async function autosave() {
		const body = payload(false, true);
		saveState = 'saving';
		try {
			const res = await postAction(saveUrl(), { payload: body });
			if (!res.ok) throw new Error('save failed');
			writeDraft(true);
			saveState = 'saved';
		} catch (e) {
			if (isOffline(e)) enqueue(saveUrl(), [['payload', body]], data.habitName);
			saveState = 'local';
		}
	}

	/** Every set counts as done on a quick log, since only some fields are shown. */
	function payload(finish: boolean, stay = false) {
		const entries: { taskId: string; values: Values }[] = [];
		data.items.forEach((it, i) => {
			const t = it.task;
			if (!t) return;
			const s = log[i];
			const repeatingIds = t.metrics.filter((m) => m.repeats).map((m) => m.id);
			// Finish saves every set with a value typed in, ticked or not; Save for later keeps only ticked ones.
			const hasValue = (set: { done: boolean; values: Values }) =>
				set.done || (quickMode && finish) || (finish && repeatingIds.some((id) => set.values[id] !== null && set.values[id] !== undefined && set.values[id] !== ''));
			for (const set of s.sets.filter(hasValue)) {
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
		return JSON.stringify({ finish, stay, notes, entries, level, back: data.back });
	}

	const empty = (v: unknown) => v === undefined || v === null || v === '' || v === false;
	/** Required fields that are still empty, by name. */
	function missing(): string[] {
		const out: string[] = [];
		data.items.forEach((it, i) => {
			const t = it.task;
			if (!t) return;
			for (const m of t.metrics.filter((x) => x.required)) {
				const bad = m.repeats
					? log[i].sets.some((s) => (s.done || quickMode) && empty(s.values[m.id])) || !log[i].sets.length
					: empty(log[i].summary[m.id]);
				if (bad) out.push(`${t.name}: ${m.name}`);
			}
		});
		return out;
	}

	function setDone(i: number, j: number, done: boolean) {
		log[i].sets[j].done = done;
		const t = data.items[i].task;
		if (done && t?.restTimerEnabled) restEnd = Date.now() + t.restTimerSeconds * 1000;
	}

	/** Changing a set's value marks it done: you did that set. */
	function setValue(i: number, j: number, metricId: string, v: unknown) {
		const set = log[i].sets[j];
		set.values[metricId] = v;
		if (!set.done) set.done = true;
	}

	function finishRemaining(i: number) {
		for (const s of log[i].sets) s.done = true;
	}

	function addSet(i: number) {
		const last = log[i].sets.at(-1);
		log[i].sets.push({ done: false, values: { ...(last?.values ?? {}) } });
	}

	function resetItem(i: number) {
		log[i] = initial()[i];
		const b = [...base];
		b[i] = structuredClone($state.snapshot(log[i]));
		base = b;
	}

	const changedSet = (i: number, j: number, id: string) =>
		isOpen && base[i]?.sets[j] !== undefined && (base[i].sets[j].values[id] ?? null) !== (log[i].sets[j].values[id] ?? null);
	const changedSummary = (i: number, id: string) =>
		isOpen && (base[i]?.summary[id] ?? null) !== (log[i].summary[id] ?? null);
	/** The value is still the untouched prefill (last time or the target), not something logged now. */
	const isPrefill = (i: number, id: string) =>
		isOpen && !data.items[i].saved.length && base[i]?.summary[id] != null && !changedSummary(i, id);

	async function sameAsLast() {
		if (data.past) return sameAsLastPast();
		const res = await postAction('/?/same', { occurrence: data.occurrence.id }).catch((e) => e);
		if (res instanceof Error) {
			if (isOffline(res)) {
				enqueue('/?/same', [['occurrence', data.occurrence.id]], data.habitName);
				clearDraft();
				showToast(`Logged ${data.habitName}. It will sync when you're back online.`);
				return goto(data.back);
			}
			problem = 'Could not save. Try again.';
			return;
		}
		clearDraft();
		goto(`/?did=${data.occurrence.id}&clear=1`);
	}

	/** A past day: copy the last log from before that day, then go back to the day. */
	async function sameAsLastPast() {
		try {
			const res = await postAction(`/day/${data.occurrence.date}?/same`, { habit: data.habitId });
			const r = await res.json();
			if (r.type === 'redirect') return goto(r.location);
			if (r.type !== 'success') throw new Error('refused');
		} catch {
			problem = 'Could not save. Try again.';
			return;
		}
		clearDraft();
		goto(`${data.back}${data.back.includes('?') ? '&' : '?'}did=${data.occurrence.id}`);
	}

	const canRepeat = $derived(isOpen && data.items.some((it) => it.previous.length));

	const dateLabel = $derived(
		new Date(data.occurrence.date + 'T12:00:00').toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		})
	);

	const prevSummary = (i: number) => data.items[i].previous.find(isSummary) ?? {};
	const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v));
	const stepOf = (m: Metric) => m.step ?? defaultStep(m.type, m.unit);
	const isNumeric = (m: Metric) => m.type === 'number' || m.type === 'count' || m.type === 'duration';
	/** Required fields always show, so a quick log can always be finished. */
	const shownMetrics = (ms: Metric[]) => (quickMode ? ms.filter((m) => m.quick || m.required) : ms);
</script>

<svelte:head><title>{data.habitName} · ittracks</title></svelte:head>

<header class="bar">
	<div>
		<h1>{quickMode ? `Quick log: ${data.habitName}` : data.habitName}</h1>
		<div class="muted">
			{[data.variantName, dateLabel, data.occurrence.status !== 'due' ? data.occurrence.status : null]
				.filter(Boolean)
				.join(' · ')}
			{#if saveState === 'saving'}· saving…{:else if saveState === 'saved'}· saved{:else if saveState === 'local'}· saved on this device{/if}
		</div>
	</div>
	<a href={data.back}>Back</a>
</header>

{#if !data.canLog && data.occurrence.status !== 'done'}
	<p class="card muted small-text">This day is further back than Settings allow logging, so it can only be looked at. <a href="/settings/past-days">Change it in Settings</a>.</p>
{:else if data.past && isOpen}
	<p class="muted small-text past">Logging a past day. It counts like a log on the day.</p>
{/if}

{#if canRepeat && !quickMode}
	<div class="row repeat">
		<button type="button" class="primary grow" onclick={sameAsLast}>Same as last time</button>
		<span class="muted small-text">{data.past ? 'Copies your last log from before this day and finishes.' : 'Copies your last log and finishes.'}</span>
	</div>
{/if}

{#if data.levels}
	<fieldset class="card levels" aria-label="Level">
		<div class="chips">
			{#each ['minimum', 'target', 'stretch'] as const as l (l)}
				<button type="button" class="chip" class:on={level === l} onclick={() => (level = l)}>{levelNames[l]}</button>
			{/each}
		</div>
		{#if data.levels[level]}<p class="muted small-text" style="margin: 0.4rem 0 0">{data.levels[level]}</p>{/if}
	</fieldset>
{/if}

{#each data.items as it, i (it.slotId)}
	{@const t = it.task}
	{#if !quickMode || (t && shownMetrics(t.metrics).length)}
	<section class="card stack">
		<div class="row">
			<h2 class="grow" style="margin: 0">{t?.name ?? 'No matching Task'}</h2>
			{#if it.open && !quickMode}
				<form method="POST" action="?/reroll" use:enhance={() => async ({ update }) => { await update(); resetItem(i); }}>
					<input type="hidden" name="slot" value={it.slotId} />
					<button class="small" title="Pick another Task">Reroll</button>
				</form>
			{/if}
			{#if !quickMode}
				<details class="swap">
					<summary class="small-text">Swap</summary>
					<form method="POST" action="?/swap" class="row" use:enhance={() => async ({ update }) => { await update(); resetItem(i); }}>
						<input type="hidden" name="slot" value={it.slotId} />
						<select name="task" aria-label="Task to use">
							{#each data.library as l (l.id)}<option value={l.id} selected={l.id === t?.id}>{l.name}</option>{/each}
						</select>
						<button class="small">Use</button>
					</form>
				</details>
			{/if}
		</div>
		{#if it.open && !t}
			<p class="muted">No Task in your Library matches this slot's rules. <a href="/library">Open the Library</a>.</p>
		{/if}
		{#if t && data.recap[t.id]}
			{@const rc = data.recap[t.id]}
			<p class="muted small-text recap">
				Last time ({new Date(rc.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}): {rc.text}{rc.best ? ` · best ${rc.best}` : ''}{' · '}<a href="/library/{t.id}">History</a>
			</p>
		{/if}

		{#if t}
			{@const repeating = shownMetrics(t.metrics.filter((m) => m.repeats))}
			{@const single = shownMetrics(t.metrics.filter((m) => !m.repeats))}

			{#if repeating.length}
				<table class="sets">
					<thead>
						<tr>
							<th>Set</th>
							{#each repeating as m (m.id)}<th>{m.name}{m.unit ? ` (${m.unit})` : ''}{m.required ? ' *' : ''}</th>{/each}
							{#if !quickMode}<th>Done</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each log[i].sets as set, j (j)}
							<tr class:done={set.done}>
								<td>{j + 1}</td>
								{#each repeating as m (m.id)}
									<td>
										{#if m.type === 'checkbox'}
											<input type="checkbox" checked={!!set.values[m.id]} onchange={(e) => setValue(i, j, m.id, e.currentTarget.checked)} />
										{:else if m.type === 'choice'}
											<select value={num(set.values[m.id])} onchange={(e) => setValue(i, j, m.id, e.currentTarget.value)}>
												<option value=""></option>
												{#each m.choices ?? [] as c (c)}<option>{c}</option>{/each}
											</select>
										{:else if m.type === 'text'}
											<input value={num(set.values[m.id])} oninput={(e) => setValue(i, j, m.id, e.currentTarget.value)} />
										{:else}
											<Stepper compact value={set.values[m.id] as number | null} step={stepOf(m)} label="{m.name}, set {j + 1}"
												changed={changedSet(i, j, m.id)} onchange={(v) => setValue(i, j, m.id, v)} />
										{/if}
									</td>
								{/each}
								{#if !quickMode}
									<td><input type="checkbox" class="tick" checked={set.done} onchange={(e) => setDone(i, j, e.currentTarget.checked)} aria-label="Set {j + 1} done" /></td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
				<div class="row">
					<button type="button" class="small" onclick={() => addSet(i)}>+ set</button>
					{#if log[i].sets.length}
						<button type="button" class="small" onclick={() => log[i].sets.pop()}>− set</button>
					{/if}
					{#if !quickMode && log[i].sets.some((x) => !x.done)}
						<button type="button" class="small" onclick={() => finishRemaining(i)}>Finish remaining sets as planned</button>
					{/if}
					{#if it.sets}<span class="muted small-text">Target {it.sets} sets</span>{/if}
				</div>
			{/if}

			{#each single as m (m.id)}
				{@const prev = prevSummary(i)[m.id]}
				<div>
					{#if m.type === 'checkbox'}
						<label style="color: var(--text)"
							><input type="checkbox" class="tick" checked={!!log[i].summary[m.id]} onchange={(e) => (log[i].summary[m.id] = e.currentTarget.checked)} />
							{m.name}{m.required ? ' *' : ''}</label
						>
					{:else if m.type === 'choice'}
						<label>{m.name}{m.required ? ' *' : ''}
							<select value={num(log[i].summary[m.id])} onchange={(e) => (log[i].summary[m.id] = e.currentTarget.value)}>
								<option value=""></option>
								{#each m.choices ?? [] as c (c)}<option>{c}</option>{/each}
							</select>
						</label>
					{:else if m.type === 'text'}
						<label>{m.name}{m.required ? ' *' : ''} <input value={num(log[i].summary[m.id])} oninput={(e) => (log[i].summary[m.id] = e.currentTarget.value)} /></label>
					{:else if isNumeric(m)}
						<span class="field-label">
							{m.name}{m.unit ? ` (${m.unit})` : m.type === 'duration' ? ' (min)' : ''}{m.required ? ' *' : ''}
							{#if targetAt(it, m.id) !== undefined}<span class="small-text">· {data.levels ? levelNames[level].toLowerCase() : 'target'} {targetAt(it, m.id)}</span>{/if}
							{#if prev !== undefined && isOpen}<span class="small-text">· last time {prev}</span>{/if}
						</span>
						<Stepper value={log[i].summary[m.id] as number | null} step={stepOf(m)} label={m.name}
							changed={changedSummary(i, m.id)} onchange={(v) => (log[i].summary[m.id] = v)} />
						{#if m.type === 'duration' && !quickMode && !data.past}
							<Timer
								bind:value={() => log[i].summary[m.id] as number | null, (v) => (log[i].summary[m.id] = v)}
								replace={isPrefill(i, m.id)}
								target={targetAt(it, m.id) ?? null}
								storageKey="timer:{data.occurrence.id}:{m.id}"
							/>
						{/if}
					{/if}
				</div>
			{/each}

			{#if t.subtasks.length && !quickMode}
				<div>
					{#each t.subtasks as s (s.id)}
						<label style="color: var(--text)"><input type="checkbox" class="tick" bind:checked={log[i].subs[s.id]} /> {s.name}</label>
					{/each}
				</div>
			{/if}
		{/if}
	</section>
	{/if}
{/each}

{#if data.items.length === 0}
	<p class="muted">This habit has nothing to log. Add Tasks to it in the Habit editor, or mark it done from Today.</p>
{/if}

{#if quickMode}
	<p class="muted small-text"><a href="/log/{data.occurrence.id}">Open the full log</a> to change anything else.</p>
{:else}
	<label style="margin-top: 1rem">Notes <textarea bind:value={notes} rows="2"></textarea></label>
{/if}

{#if problem}<p class="error">{problem}</p>{/if}
{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.saved}<p class="muted">Saved.</p>{/if}

{#if data.canLog || data.occurrence.status === 'done'}
<div class="actions">
	<form
		method="POST"
		action="?/save"
		class="grow-form"
		use:enhance={({ cancel }) => {
			problem = '';
			const gaps = missing();
			if (gaps.length) {
				problem = `Fill in: ${gaps.join(', ')}`;
				cancel();
				return;
			}
			clearTimeout(saveTimer);
			if (!navigator.onLine) {
				cancel();
				enqueue(saveUrl(), [['payload', payload(true, true)]], data.habitName);
				clearDraft();
				showToast(`Logged ${data.habitName}. It will sync when you're back online.`);
				goto(data.back);
				return;
			}
			return async ({ result, update }) => {
				if (result.type === 'error' && isOffline(result.error)) {
					enqueue(saveUrl(), [['payload', payload(true, true)]], data.habitName);
					clearDraft();
					showToast(`Logged ${data.habitName}. It will sync when you're back online.`);
					goto(data.back);
					return;
				}
				if (result.type === 'redirect' || result.type === 'success') clearDraft();
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="payload" value={payload(true)} />
		<button class="primary big">{data.occurrence.status === 'done' ? 'Save changes' : quickMode ? 'Save' : 'Finish'}</button>
	</form>
</div>
{/if}

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
	.past {
		margin: -0.5rem 0 0.75rem;
	}
	.levels {
		border: 1px solid var(--border);
		margin-bottom: 0.75rem;
	}
	.repeat {
		align-items: center;
		margin-bottom: 0.75rem;
	}
	.field-label {
		display: block;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.grow-form {
		flex: 1;
	}
	button.big {
		width: 100%;
		padding: 0.8rem;
		font-size: 1.05rem;
	}
	input.tick {
		width: 1.4rem;
		height: 1.4rem;
	}
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
	.sets tr.done :global(input[type='number']) {
		border-color: var(--accent);
	}
	.recap {
		margin: 0.15rem 0 0.6rem;
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
