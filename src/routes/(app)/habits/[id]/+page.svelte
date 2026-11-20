<script lang="ts">
	import { untrack } from 'svelte';
	import { deserialize, enhance } from '$app/forms';
	import type { HabitForm, ScheduleForm } from '$lib/forms';
	import { describeSchedule, weekdayNames } from '$lib/describe';
	import FillRuleEditor from './FillRuleEditor.svelte';

	let { data, form } = $props();

	type Slot = HabitForm['variants'][number]['slots'][number];

	let h = $state<HabitForm>(untrack(() => structuredClone(data.habit)));
	let mode = $state(untrack(() => data.mode));
	let step = $state(0);
	let pinned = $state(untrack(() => data.pinned));
	let tasks = $state(untrack(() => [...data.tasks]));
	let metricsByTask = $state(untrack(() => ({ ...data.metrics })));

	// A build habit always has at least one Variant to put Slots in.
	$effect(() => {
		if (h.direction === 'build' && h.variants.length === 0) addVariant();
	});

	// ----- Schedule editor state, seeded from the saved Schedule -----
	const s0 = untrack(() => data.habit.schedule);
	const savedStart = untrack(() => data.habit.startDate);
	let kind = $state<ScheduleForm['kind']>(s0?.kind ?? 'weekly');
	let weeklyDays = $state<Record<string, string>>(s0?.kind === 'weekly' ? { ...s0.days } : {});
	let times = $state(s0?.kind === 'frequency' ? s0.times : 3);
	let period = $state<'week' | 'month'>(s0?.kind === 'frequency' ? s0.period : 'week');
	let every = $state(s0?.kind === 'interval' ? s0.every : 1);
	let singleVariant = $state(s0?.kind === 'frequency' || s0?.kind === 'interval' ? s0.variantId : '');
	let step_ = $state<'variant' | 'week'>(s0?.kind === 'rotation' ? s0.step : 'variant');
	let onMiss = $state<'wait' | 'skip'>(s0?.kind === 'rotation' ? s0.onMiss : 'wait');
	let restDays = $state<Record<string, number>>(
		s0?.kind === 'rotation' ? Object.fromEntries(s0.order.map((o) => [o.variantId, o.restDays])) : {}
	);
	let weekdays = $state<number[]>(s0?.kind === 'rotation' ? [...s0.weekdays] : [0, 2, 4]);
	let start = $state(
		s0?.kind === 'rotation' || s0?.kind === 'interval' ? s0.start : savedStart
	);

	const firstVariant = $derived(h.variants[0]?.id ?? '');

	/** The Schedule as it will be saved. Rotations follow the Variant order. */
	const schedule = $derived.by((): ScheduleForm | null => {
		if (h.direction === 'break') return null;
		const ids = new Set(h.variants.map((v) => v.id));
		const pick = ids.has(singleVariant) ? singleVariant : firstVariant;
		switch (kind) {
			case 'weekly':
				return {
					kind,
					days: Object.fromEntries(Object.entries(weeklyDays).filter(([, v]) => ids.has(v)))
				};
			case 'frequency':
				return { kind, times, period, variantId: pick };
			case 'interval':
				return { kind, every, start, variantId: pick };
			case 'rotation':
				return {
					kind,
					step: step_,
					onMiss,
					start,
					weekdays: step_ === 'week' ? [...weekdays].sort() : [],
					order: h.variants.map((v) => ({ variantId: v.id, restDays: restDays[v.id] ?? 1 }))
				};
		}
	});
	// ----- Cue, stacking, levels, streak, identity, if-then -----
	let afterMode = $state<'none' | 'habit' | 'text'>(
		untrack(() => (h.cue.afterHabitId ? 'habit' : h.cue.afterText ? 'text' : 'none'))
	);
	const buildHabits = $derived(data.habits.filter((x) => x.direction === 'build'));
	const cue = $derived({
		time: h.cue.time || null,
		place: h.cue.place?.trim() || null,
		afterHabitId: afterMode === 'habit' ? h.cue.afterHabitId || null : null,
		afterText: afterMode === 'text' ? h.cue.afterText?.trim() || null : null,
		range: h.cue.range || null
	});
	const intention = $derived.by(() => {
		const anchor = cue.afterHabitId
			? data.habits.find((x) => x.id === cue.afterHabitId)?.name
			: cue.afterText;
		const what = h.name.trim() || 'do this';
		let line = `${anchor ? `After ${anchor}, I` : 'I'} will ${what}`;
		if (cue.time) line += ` at ${cue.time}`;
		else if (cue.range) line += ` in the ${cue.range.toLowerCase()}`;
		if (cue.place) line += ` ${cue.place}`;
		return anchor || cue.time || cue.place || cue.range ? `${line}.` : '';
	});

	function setRule(kind: HabitForm['streakRule']['kind']) {
		h.streakRule =
			kind === 'grace'
				? { kind, misses: 1, period: 'week' }
				: kind === 'consistency'
					? { kind, days: 30 }
					: { kind };
	}

	let identities = $state(untrack(() => [...data.identities]));
	let newIdentity = $state('');
	let identityError = $state('');
	function toggleIdentity(id: string) {
		h.identityIds = h.identityIds.includes(id)
			? h.identityIds.filter((x) => x !== id)
			: [...h.identityIds, id];
	}
	async function createIdentity() {
		identityError = '';
		const body = new FormData();
		body.set('statement', newIdentity);
		const res = await fetch('?/identity', {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		const r = deserialize(await res.text());
		if (r.type === 'success' && r.data) {
			const { identityId, statement } = r.data as { identityId: string; statement: string };
			identities.push({ id: identityId, statement });
			h.identityIds = [...h.identityIds, identityId];
			newIdentity = '';
		} else identityError = 'Could not add that identity.';
	}

	let newTrigger = $state('');
	function addTrigger() {
		const t = newTrigger.trim();
		if (t && !h.triggers.includes(t)) h.triggers = [...h.triggers, t];
		newTrigger = '';
	}

	function setTarget(map: Record<string, number>, metricId: string, value: string) {
		if (value === '') delete map[metricId];
		else map[metricId] = Number(value);
	}

	const payload = $derived(JSON.stringify({ ...h, schedule, cue, pinned }));

	// ----- Schedule presets: one tap fills the schedule editor -----
	type Preset = 'daily' | 'weekdays' | 'mwf' | 'three' | 'ab';
	function applyPreset(p: Preset) {
		const v = h.variants[0]?.id;
		if (!v) return;
		if (p === 'daily') {
			kind = 'weekly';
			weeklyDays = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), v]));
		} else if (p === 'weekdays') {
			kind = 'weekly';
			weeklyDays = Object.fromEntries([0, 1, 2, 3, 4].map((d) => [String(d), v]));
		} else if (p === 'mwf') {
			kind = 'weekly';
			weeklyDays = Object.fromEntries([0, 2, 4].map((d) => [String(d), v]));
		} else if (p === 'three') {
			kind = 'frequency';
			times = 3;
			period = 'week';
			singleVariant = v;
		} else {
			if (h.variants.length < 2) addVariant();
			kind = 'rotation';
			step_ = 'variant';
			onMiss = 'wait';
			restDays = Object.fromEntries(h.variants.map((x) => [x.id, 1]));
		}
	}
	const presetOn = $derived.by((): Preset | null => {
		if (kind === 'frequency' && times === 3 && period === 'week') return 'three';
		if (kind === 'rotation' && step_ === 'variant' && h.variants.length === 2) return 'ab';
		if (kind !== 'weekly') return null;
		const days = Object.keys(weeklyDays).filter((d) => weeklyDays[d]).sort().join('');
		return days === '0123456' ? 'daily' : days === '01234' ? 'weekdays' : days === '024' ? 'mwf' : null;
	});

	// ----- Sections that are off stay folded away until asked for -----
	const has = untrack(() => ({
		when: !!(data.habit.cue.time || data.habit.cue.place || data.habit.cue.afterHabitId || data.habit.cue.afterText || data.habit.cue.range),
		levels: data.habit.levels.enabled,
		streak: !data.isNew && data.habit.streakRule.kind !== 'neverTwice',
		identity: data.habit.identityIds.length > 0,
		notes: !!data.habit.notes
	}));
	let open = $state(
		untrack(() => ({
			when: data.showAllSections || has.when,
			levels: data.showAllSections || has.levels,
			streak: data.showAllSections || has.streak,
			identity: data.showAllSections || has.identity,
			notes: data.showAllSections || has.notes
		}))
	);

	// ----- New Task without leaving the editor -----
	let newTaskFor = $state<string | null>(null);
	let newTaskName = $state('');
	let newTaskType = $state('strength');
	let newTaskError = $state('');
	async function createTask(s: Slot) {
		newTaskError = '';
		const body = new FormData();
		body.set('name', newTaskName);
		body.set('type', newTaskType);
		body.set('areaId', h.areaId ?? '');
		const res = await fetch('?/quickTask', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const r = deserialize(await res.text());
		if (r.type === 'success' && r.data?.newTask) {
			const t = r.data.newTask as { id: string; name: string; metrics: { id: string; name: string; unit: string }[] };
			tasks = [...tasks, { id: t.id, name: t.name }].sort((a, b) => a.name.localeCompare(b.name));
			metricsByTask = { ...metricsByTask, [t.id]: t.metrics };
			s.taskId = t.id;
			s.fillRule = null;
			newTaskFor = null;
			newTaskName = '';
		} else newTaskError = 'Could not create that Task.';
	}

	function duplicateVariant(vi: number) {
		const v = h.variants[vi];
		const letter = String.fromCharCode(65 + h.variants.length);
		h.variants.splice(vi + 1, 0, {
			id: crypto.randomUUID(),
			name: `${v.name} copy`.slice(0, 120) || letter,
			slots: v.slots.map((x) => ({ ...structuredClone($state.snapshot(x)), id: crypto.randomUUID() }))
		});
	}

	const guidedSteps = ['What', 'When', 'Cue', 'Check'];
	const canNext = $derived(step === 0 ? !!h.name.trim() : true);
	const shortDate = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

	function addVariant() {
		const letter = String.fromCharCode(65 + h.variants.length);
		h.variants.push({ id: crypto.randomUUID(), name: letter, slots: [] });
	}

	function addSlot(slots: Slot[], open: boolean) {
		slots.push({
			id: crypto.randomUUID(),
			taskId: open ? null : (tasks[0]?.id ?? null),
			fillRule: open ? { must: {}, mustNot: {}, prefer: [] } : null,
			sets: null,
			targets: {},
			minTargets: {},
			stretchTargets: {}
		});
	}

	function move<T>(list: T[], i: number, by: number) {
		const j = i + by;
		if (j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j], list[i]];
	}

	function toggleWeekday(d: number) {
		weekdays = weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d];
	}
</script>

<svelte:head><title>{data.isNew ? 'New habit' : h.name} · ittracks</title></svelte:head>

{#snippet whatYouDo()}
	{#if h.variants.length > 1}
		<p class="muted">Each Variant is a version of this habit, like Push day A and Pull day B.</p>
	{/if}

	{#each h.variants as v, vi (v.id)}
		<div class="card stack">
			{#if h.variants.length > 1}
				<div class="row">
					<label class="grow">Variant name <input bind:value={v.name} required /></label>
					<button type="button" class="small" onclick={() => move(h.variants, vi, -1)} aria-label="Move up">↑</button>
					<button type="button" class="small" onclick={() => move(h.variants, vi, 1)} aria-label="Move down">↓</button>
					<button type="button" class="small" onclick={() => duplicateVariant(vi)}>Duplicate</button>
					<button type="button" class="small danger" onclick={() => h.variants.splice(vi, 1)}>Remove</button>
				</div>
			{/if}

			{#each v.slots as s, si (s.id)}
				<div class="slot stack">
					<div class="row">
						<strong class="grow">{s.fillRule ? 'Auto-filled slot' : (tasks.find((t) => t.id === s.taskId)?.name ?? `Slot ${si + 1}`)}</strong>
						<button type="button" class="small" onclick={() => move(v.slots, si, -1)} aria-label="Move up">↑</button>
						<button type="button" class="small" onclick={() => move(v.slots, si, 1)} aria-label="Move down">↓</button>
						<button type="button" class="small danger" onclick={() => v.slots.splice(si, 1)}>Remove</button>
					</div>
					{#if s.fillRule}
						<FillRuleEditor bind:rule={s.fillRule} tags={data.tags} />
					{:else}
						<label
							>Task
							<select
								value={s.taskId ?? ''}
								onchange={(e) => {
									if (e.currentTarget.value === '__new') {
										newTaskFor = s.id;
										e.currentTarget.value = s.taskId ?? '';
									} else s.taskId = e.currentTarget.value;
								}}
								required
							>
								{#each tasks as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
								<option value="__new">+ New Task…</option>
							</select>
						</label>
					{/if}
					{#if newTaskFor === s.id}
						<div class="card stack newtask">
							<label>New Task name <input bind:value={newTaskName} placeholder="Bench press" /></label>
							<div class="chips">
								{#each data.types as type (type.key)}
									<button type="button" class="chip" class:on={newTaskType === type.key} title={type.description} onclick={() => (newTaskType = type.key)}>{type.name}</button>
								{/each}
							</div>
							<p class="muted small-text" style="margin: 0">{data.types.find((x) => x.key === newTaskType)?.description}</p>
							<div class="row">
								<button type="button" class="primary small" onclick={() => createTask(s)} disabled={!newTaskName.trim()}>Create and use</button>
								<button type="button" class="small" onclick={() => (newTaskFor = null)}>Cancel</button>
							</div>
							{#if newTaskError}<p class="error">{newTaskError}</p>{/if}
						</div>
					{/if}
					<label style="width: 8rem"
						>Target sets
						<input
							type="number"
							min="0"
							max="50"
							value={s.sets ?? ''}
							oninput={(e) => (s.sets = e.currentTarget.value ? Number(e.currentTarget.value) : null)}
						/>
					</label>
					{#if !s.fillRule && s.taskId && metricsByTask[s.taskId]?.length}
						<table class="targets">
							<thead>
								<tr>
									<th></th>
									{#if h.levels.enabled}<th>Minimum</th>{/if}
									<th>Target</th>
									{#if h.levels.enabled}<th>Stretch</th>{/if}
								</tr>
							</thead>
							<tbody>
								{#each metricsByTask[s.taskId] as m (m.id)}
									<tr>
										<td>{m.name}{m.unit ? ` (${m.unit})` : ''}</td>
										{#if h.levels.enabled}
											<td><input type="number" step="any" inputmode="decimal" value={s.minTargets[m.id] ?? ''}
												oninput={(e) => setTarget(s.minTargets, m.id, e.currentTarget.value)} aria-label="{m.name} minimum" /></td>
										{/if}
										<td><input type="number" step="any" inputmode="decimal" value={s.targets[m.id] ?? ''}
											oninput={(e) => setTarget(s.targets, m.id, e.currentTarget.value)} aria-label="{m.name} target" /></td>
										{#if h.levels.enabled}
											<td><input type="number" step="any" inputmode="decimal" value={s.stretchTargets[m.id] ?? ''}
												oninput={(e) => setTarget(s.stretchTargets, m.id, e.currentTarget.value)} aria-label="{m.name} stretch" /></td>
										{/if}
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			{/each}

			<div class="row">
				{#if tasks.length}
					<button type="button" onclick={() => addSlot(v.slots, false)}>Add a Task</button>
				{:else}
					<button type="button" onclick={() => { addSlot(v.slots, false); newTaskFor = v.slots.at(-1)!.id; }}>Add a new Task</button>
				{/if}
				<button type="button" onclick={() => addSlot(v.slots, true)}>Add an auto-filled slot</button>
			</div>
			{#if !v.slots.length}
				<p class="muted small-text" style="margin: 0">No Tasks means there's nothing to fill in: you just tick it off.</p>
			{/if}
		</div>
	{/each}
	<button type="button" onclick={addVariant}
		>{h.variants.length > 1 ? 'Add a Variant' : 'Add another Variant (for A/B plans)'}</button
	>
{/snippet}

{#snippet schedulePart()}
	<div class="chips" role="group" aria-label="Quick schedules">
		<button type="button" class="chip" class:on={presetOn === 'daily'} onclick={() => applyPreset('daily')}>Every day</button>
		<button type="button" class="chip" class:on={presetOn === 'weekdays'} onclick={() => applyPreset('weekdays')}>Weekdays</button>
		<button type="button" class="chip" class:on={presetOn === 'mwf'} onclick={() => applyPreset('mwf')}>Mon, Wed, Fri</button>
		<button type="button" class="chip" class:on={presetOn === 'three'} onclick={() => applyPreset('three')}>3 times a week</button>
		<button type="button" class="chip" class:on={presetOn === 'ab'} onclick={() => applyPreset('ab')}>A/B with 1 rest day</button>
	</div>
	<label
		>How often
		<select bind:value={kind}>
			<option value="weekly">On fixed weekdays</option>
			<option value="frequency">A number of times per week or month</option>
			<option value="interval">Every few days</option>
			<option value="rotation">Rotate through Variants</option>
		</select>
	</label>

	{#if kind === 'weekly'}
		{#each weekdayNames as day, d (day)}
			<div class="row">
				<span style="width: 3rem">{day}</span>
				<select class="grow" bind:value={weeklyDays[d]} aria-label="Variant on {day}">
					<option value="">Rest</option>
					{#each h.variants as v (v.id)}<option value={v.id}>{h.variants.length > 1 ? v.name : 'Do it'}</option>{/each}
				</select>
			</div>
		{/each}
	{:else if kind === 'frequency'}
		<div class="row">
			<label style="width: 6rem">Times <input type="number" min="1" max="31" bind:value={times} /></label>
			<label class="grow"
				>Per
				<select bind:value={period}>
					<option value="week">week</option>
					<option value="month">month</option>
				</select>
			</label>
		</div>
	{:else if kind === 'interval'}
		<div class="row">
			<label style="width: 8rem">Every N days <input type="number" min="1" max="365" bind:value={every} /></label>
			<label class="grow">Starting <input type="date" bind:value={start} /></label>
		</div>
	{:else}
		<label
			>Rotate by
			<select bind:value={step_}>
				<option value="variant">Variant, with rest days between them</option>
				<option value="week">Week: a different Variant each week</option>
			</select>
		</label>
		{#if step_ === 'variant'}
			{#each h.variants as v (v.id)}
				<div class="row">
					<span class="grow">After {v.name}, rest</span>
					<input
						type="number"
						min="0"
						max="30"
						style="width: 5rem"
						value={restDays[v.id] ?? 1}
						oninput={(e) => (restDays[v.id] = Number(e.currentTarget.value))}
						aria-label="Rest days after {v.name}"
					/>
					<span>days</span>
				</div>
			{/each}
			<fieldset class="card">
				<legend class="muted">If you miss a day</legend>
				<label style="color: var(--text)"
					><input type="radio" bind:group={onMiss} value="wait" /> Wait: the Variant stays due until
					you do it</label
				>
				<label style="color: var(--text)"
					><input type="radio" bind:group={onMiss} value="skip" /> Skip ahead to the next Variant</label
				>
			</fieldset>
		{:else}
			<div class="chips" role="group" aria-label="Training days">
				{#each weekdayNames as day, d (day)}
					<button type="button" class="chip small" class:on={weekdays.includes(d)} onclick={() => toggleWeekday(d)}
						>{day}</button
					>
				{/each}
			</div>
			<p class="muted">Variants take turns week by week, in the order listed above.</p>
		{/if}
		<label>Starting <input type="date" bind:value={start} /></label>
	{/if}

	{#if (kind === 'frequency' || kind === 'interval') && h.variants.length > 1}
		<label
			>Variant
			<select bind:value={singleVariant}>
				{#each h.variants as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
			</select>
		</label>
	{/if}
{/snippet}

{#snippet cuePart()}
	<div class="row">
		<label style="width: 8rem"
			>Time
			<input type="time" value={h.cue.time ?? ''} oninput={(e) => (h.cue.time = e.currentTarget.value || null)} />
		</label>
		{#if data.ranges.length}
			<label class="grow"
				>Or part of the day
				<select value={h.cue.range ?? ''} onchange={(e) => (h.cue.range = e.currentTarget.value || null)}>
					<option value="">Any</option>
					{#each data.ranges as r (r.name)}<option value={r.name}>{r.name} ({r.start}–{r.end})</option>{/each}
				</select>
			</label>
		{/if}
	</div>
	<label
		>Where <input value={h.cue.place ?? ''} oninput={(e) => (h.cue.place = e.currentTarget.value)} placeholder="in the park" />
	</label>
	<label
		>After
		<select bind:value={afterMode}>
			<option value="none">Nothing in particular</option>
			{#if buildHabits.length}<option value="habit">Another habit</option>{/if}
			<option value="text">Something else I do</option>
		</select>
	</label>
	{#if afterMode === 'habit'}
		<select
			value={h.cue.afterHabitId ?? ''}
			onchange={(e) => (h.cue.afterHabitId = e.currentTarget.value || null)}
			aria-label="Habit to stack after"
		>
			<option value="">Pick a habit</option>
			{#each buildHabits as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
		</select>
	{:else if afterMode === 'text'}
		<input value={h.cue.afterText ?? ''} oninput={(e) => (h.cue.afterText = e.currentTarget.value)}
			placeholder="I pour my morning coffee" aria-label="What this comes after" />
	{/if}
	{#if intention}<p class="intention">{intention}</p>{/if}
	<label style="color: var(--text)"
		><input type="checkbox" bind:checked={h.remind} disabled={!h.cue.time && !h.cue.range} /> Remind me {h.cue.time ? 'at this time' : h.cue.range ? `when the ${h.cue.range.toLowerCase()} starts` : '(set a time first)'}</label
	>
	{#if h.remind}
		<p class="muted small-text">Turn on reminders for this device in <a href="/settings">Settings</a>.</p>
	{/if}
{/snippet}

{#snippet identityPart()}
	<p class="muted">Who does this habit make you? Each time you do it is a vote for that identity.</p>
	{#if identities.length}
		<div class="chips">
			{#each identities as i (i.id)}
				<button type="button" class="chip" class:on={h.identityIds.includes(i.id)} onclick={() => toggleIdentity(i.id)}
					>{i.statement}</button
				>
			{/each}
		</div>
	{/if}
	<div class="row">
		<input class="grow" bind:value={newIdentity} placeholder="I am a runner" aria-label="New identity"
			onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), newIdentity.trim() && createIdentity())} />
		<button type="button" onclick={createIdentity} disabled={!newIdentity.trim()}>Add</button>
	</div>
	{#if identityError}<p class="error">{identityError}</p>{/if}
{/snippet}

{#snippet typePart()}
	<fieldset class="card">
		<legend class="muted">Type</legend>
		<label style="color: var(--text)"
			><input type="radio" bind:group={h.direction} value="build" /> Build: something to do</label
		>
		<label style="color: var(--text)"
			><input type="radio" bind:group={h.direction} value="break" /> Break: something to stop, with
			a slip counter</label
		>
	</fieldset>
{/snippet}

{#snippet areaPart()}
	{#if data.areas.length}
		<div>
			<span class="muted small-text">Area</span>
			<div class="chips">
				<button type="button" class="chip" class:on={!h.areaId} onclick={() => (h.areaId = null)}>None</button>
				{#each data.areas as a (a.id)}
					<button type="button" class="chip" class:on={h.areaId === a.id} onclick={() => (h.areaId = a.id)}>{a.icon} {a.name}</button>
				{/each}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet breakPart()}
	<label>Counting from <input type="date" bind:value={h.startDate} required /></label>
	<p class="muted">
		The habit shows the days since your last slip. Log a slip whenever it happens and the
		counter goes back to 0.
	</p>

	<h2>If-then plan</h2>
	<p class="muted">Decide now what you'll do when the urge comes, so you have something to do instead.</p>
	<div class="row">
		<label class="grow">If I <input bind:value={h.ifThen.when} placeholder="want a cigarette" /></label>
		<label class="grow">then I will <input bind:value={h.ifThen.then} placeholder="do 10 push-ups" /></label>
	</div>
	{#if buildHabits.length}
		<label
			>Or do one of your habits instead
			<select
				value={h.ifThen.habitId ?? ''}
				onchange={(e) => (h.ifThen.habitId = e.currentTarget.value || null)}
			>
				<option value="">None</option>
				{#each buildHabits as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
			</select>
		</label>
	{/if}

	<h2>Slip triggers</h2>
	<p class="muted">Feelings you can pick when you log a slip. Over time Today shows which ones come up most.</p>
	<div class="chips">
		{#each h.triggers as t, ti (t)}
			<span class="chip on"
				>{t}
				<button type="button" class="link" onclick={() => h.triggers.splice(ti, 1)} aria-label="Remove {t}">×</button></span
			>
		{/each}
	</div>
	<div class="row">
		<input class="grow" bind:value={newTrigger} placeholder="Add a feeling" aria-label="New trigger"
			onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addTrigger())} />
		<button type="button" onclick={addTrigger}>Add</button>
	</div>
{/snippet}

{#if mode === 'choose'}
	<header class="bar">
		<h1>New habit</h1>
		<a href="/habits">Cancel</a>
	</header>
	<p class="muted">How do you want to start?</p>
	<ul class="list" data-sveltekit-reload>
		<li><a class="card" href="/gallery"><strong>Pick a ready-made habit</strong><div class="muted small-text">Gym plans, language practice, reading, quitting smoking and more. Adjust it after.</div></a></li>
		<li><a class="card" href="?mode=guided{data.habit.areaId ? `&area=${data.habit.areaId}` : ''}"><strong>Build it step by step</strong><div class="muted small-text">Four short steps: what you do, which days, when, and a check.</div></a></li>
		{#if data.habits.length}
			<li class="card">
				<strong>Copy one of my habits</strong>
				<div class="chips">
					{#each data.habits as x (x.id)}<a class="chip" href="?from={x.id}">{x.name}</a>{/each}
				</div>
			</li>
		{/if}
		<li><a class="card" href="?mode=full"><strong>Start blank in the full editor</strong><div class="muted small-text">Every option on one page.</div></a></li>
	</ul>
	<p class="muted small-text">You can skip this choice in <a href="/settings">Settings</a>.</p>
{:else}
<header class="bar">
	<h1>{data.isNew ? (data.copiedFrom ? `Copy of ${data.copiedFrom}` : 'New habit') : 'Edit habit'}</h1>
	<div class="row">
		{#if !data.isNew}
			<a href="/habits/new?from={data.id}" data-sveltekit-reload>Duplicate</a>
			<a href="/habits/{data.id}/template.json" download>Export template</a>
		{/if}
		<a href="/habits">Cancel</a>
	</div>
</header>

{#if data.archived}
	<form method="POST" action="?/unarchive" class="card row" style="align-items: center; margin-bottom: 1rem" use:enhance>
		<span class="grow">This habit is archived: hidden from Today, with its history kept.</span>
		<button class="small">Unarchive</button>
	</form>
{/if}

<form method="POST" action="?/save" class="stack" id="habit-form">
	<input type="hidden" name="payload" value={payload} />

	{#if mode === 'guided'}
		<ol class="steps" aria-label="Steps">
			{#each guidedSteps as g, gi (g)}
				<li class:on={gi === step} class:done={gi < step}><button type="button" class="link" onclick={() => (step = gi)} disabled={gi > step && !canNext}>{gi + 1}. {g}</button></li>
			{/each}
		</ol>

		{#if step === 0}
			<label>What's the habit called? <input bind:value={h.name} placeholder="Gym, Spanish, Read" required /></label>
			{@render typePart()}
			{@render areaPart()}
			{#if h.direction === 'build'}
				<h2>What you do</h2>
				<p class="muted small-text">Add the Tasks you log, like exercises or "new words". Leave it empty for a simple tick-off habit.</p>
				{@render whatYouDo()}
			{:else}
				{@render breakPart()}
			{/if}
		{:else if step === 1}
			{#if h.direction === 'build'}
				<h2>Which days?</h2>
				{@render schedulePart()}
			{:else}
				<p class="muted">Break habits are tracked every day, so there's no schedule to set.</p>
			{/if}
		{:else if step === 2}
			<h2>When and where</h2>
			<p class="muted">Optional. A clear time and place make a habit easier to start.</p>
			{@render cuePart()}
		{:else}
			<h2>Check</h2>
			<div class="card stack">
				<div><strong>{h.name || 'Unnamed habit'}</strong> · {h.direction === 'break' ? 'Break habit' : describeSchedule(schedule)}</div>
				{#if h.direction === 'build'}
					<div class="muted small-text">
						{h.variants.flatMap((v) => v.slots).length
							? h.variants.flatMap((v) => v.slots.map((x) => (x.fillRule ? 'auto-filled' : tasks.find((t) => t.id === x.taskId)?.name))).filter(Boolean).join(', ')
							: 'Nothing to fill in: just tick it off'}
					</div>
				{/if}
				{#if intention}<div class="intention">{intention}</div>{/if}
				<div class="muted small-text">Streak: never miss twice (one miss is forgiven). Levels, identity and more are in the full editor any time.</div>
			</div>
			<label style="color: var(--text)"><input type="checkbox" bind:checked={pinned} /> Add to home screen shortcuts</label>
		{/if}

		{#if form?.error}<p class="error">{form.error}</p>{/if}
		<div class="actions">
			{#if step > 0}<button type="button" onclick={() => step--}>Back</button>{:else}<span></span>{/if}
			{#if step < guidedSteps.length - 1}
				<button type="button" class="primary" onclick={() => step++} disabled={!canNext}>Next</button>
			{:else}
				<button class="primary">Save habit</button>
			{/if}
		</div>
		<p class="muted small-text"><button type="button" class="link" onclick={() => (mode = 'full')}>Skip to the full editor</button></p>
	{:else}
	<label>Name <input bind:value={h.name} placeholder="Gym" required /></label>

	{@render typePart()}
	{@render areaPart()}

	{#if h.direction === 'break'}
		{@render breakPart()}
	{:else}
		<h2>{h.variants.length > 1 ? 'Variants' : 'What you do'}</h2>
		{@render whatYouDo()}

		<h2>Schedule</h2>
		{@render schedulePart()}

		{#if open.when}
			<h2>When and where</h2>
			<p class="muted">Optional. A clear time and place make a habit easier to start.</p>
			{@render cuePart()}
		{/if}

		{#if open.levels}
			<h2>Levels</h2>
			<label style="color: var(--text)"
				><input type="checkbox" bind:checked={h.levels.enabled} /> Use levels: a two-minute Minimum, your Target, and a Stretch</label
			>
			{#if h.levels.enabled}
				<label>Minimum <input bind:value={h.levels.minimum} placeholder="Put on running shoes" /></label>
				<label>Target <input bind:value={h.levels.target} placeholder="Run 5 km" /></label>
				<label>Stretch <input bind:value={h.levels.stretch} placeholder="Run 10 km" /></label>
				<label style="color: var(--text)"
					><input type="checkbox" bind:checked={h.minimumCounts} /> Doing the Minimum keeps the streak alive</label
				>
				<p class="muted small-text">Set numbers for each level per Task in the Slots above.</p>
			{/if}
		{/if}
		{#if h.variants.some((v) => v.slots.length)}
			<label style="color: var(--text)"
				><input type="checkbox" bind:checked={h.quickDone} /> One-tap Done on Today (logs your targets)</label
			>
		{/if}

		{#if open.streak}
			<h2>Streak</h2>
			<label
				>How the streak counts
				<select value={h.streakRule.kind} onchange={(e) => setRule(e.currentTarget.value as HabitForm['streakRule']['kind'])}>
					<option value="neverTwice">Never miss twice: one miss is forgiven</option>
					<option value="strict">Strict: any miss resets it</option>
					<option value="grace">Grace days: a few misses allowed</option>
					<option value="consistency">Consistency: % done, no streak</option>
				</select>
			</label>
			{#if h.streakRule.kind === 'grace'}
				<div class="row">
					<label style="width: 6rem">Misses <input type="number" min="1" max="15" bind:value={h.streakRule.misses} /></label>
					<label class="grow"
						>Per
						<select bind:value={h.streakRule.period}>
							<option value="week">week</option>
							<option value="month">month</option>
						</select>
					</label>
				</div>
			{:else if h.streakRule.kind === 'consistency'}
				<label style="width: 10rem">Over the last N days <input type="number" min="7" max="365" bind:value={h.streakRule.days} /></label>
			{/if}
		{/if}
	{/if}

	{#if open.identity}
		<h2>Identity</h2>
		{@render identityPart()}
	{/if}

	{#if open.notes}
		<label>Notes <textarea bind:value={h.notes} rows="2"></textarea></label>
	{/if}

	{#if Object.values(open).some((x) => !x)}
		<div class="chips add-more">
			{#if h.direction === 'build' && !open.when}<button type="button" class="chip" onclick={() => (open.when = true)}>+ When and where</button>{/if}
			{#if h.direction === 'build' && !open.levels}<button type="button" class="chip" onclick={() => (open.levels = true)}>+ Levels</button>{/if}
			{#if h.direction === 'build' && !open.streak}<button type="button" class="chip" onclick={() => (open.streak = true)}>+ Streak rule (now: never miss twice)</button>{/if}
			{#if !open.identity}<button type="button" class="chip" onclick={() => (open.identity = true)}>+ Identity</button>{/if}
			{#if !open.notes}<button type="button" class="chip" onclick={() => (open.notes = true)}>+ Notes</button>{/if}
		</div>
	{/if}

	{#if h.direction === 'build'}
		<label style="color: var(--text)"><input type="checkbox" bind:checked={pinned} /> Add to home screen shortcuts (long-press the app icon)</label>
	{/if}

	{#if form?.error}<p class="error">{form.error}</p>{/if}

	<div class="actions">
		<button class="primary">Save habit</button>
		{#if !data.isNew}
			<div class="row">
				{#if !data.archived}<button formaction="?/archive" formnovalidate>Archive</button>{/if}
				<button
					class="danger"
					formaction="?/delete"
					formnovalidate
					onclick={(e) => !confirm('Delete this habit and its history? Archive keeps the history.') && e.preventDefault()}
					>Delete</button
				>
			</div>
		{/if}
	</div>
	{/if}
</form>

{#if !data.isNew && h.direction === 'build' && mode === 'full'}
	<section class="card stack" id="pause" style="margin-top: 1.5rem">
		<h2 style="margin-top: 0">Pause</h2>
		<p class="muted small-text" style="margin: 0">Paused days aren't due and never break the streak. For a break from every habit, use Vacation in <a href="/settings">Settings</a>.</p>
		{#each data.pauses as p (p.id)}
			<form method="POST" action="?/unpause" class="row" style="align-items: center" use:enhance>
				<input type="hidden" name="id" value={p.id} />
				<span class="grow">{shortDate(p.start)} to {shortDate(p.end)}{p.note ? ` · ${p.note}` : ''}{p.end < data.today ? ' (past)' : ''}</span>
				<button class="small">Remove</button>
			</form>
		{/each}
		<form method="POST" action="?/pause" class="row" use:enhance>
			<label class="grow">From <input type="date" name="start" value={data.today} required /></label>
			<label class="grow">To <input type="date" name="end" value={data.today} min={data.today} required /></label>
			<label class="grow">Note <input name="note" placeholder="optional" /></label>
			<button>Pause</button>
		</form>
		{#if form?.pauseError}<p class="error">{form.pauseError}</p>{/if}
	</section>
{/if}
{/if}

<style>
	.slot {
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}
	fieldset {
		border: 1px solid var(--border);
	}
	.intention {
		font-style: italic;
		margin: 0.25rem 0;
	}
	.small-text {
		font-size: 0.85rem;
	}
	.targets {
		width: 100%;
		border-collapse: collapse;
	}
	.targets th {
		text-align: left;
		font-size: 0.8rem;
		color: var(--muted);
		font-weight: 500;
	}
	.targets td {
		padding: 0.15rem 0.25rem 0.15rem 0;
		font-size: 0.9rem;
	}
	.chip {
		background: none;
		cursor: pointer;
		text-decoration: none;
	}
	.steps {
		display: flex;
		gap: 0.75rem;
		list-style: none;
		padding: 0;
		margin: 0 0 0.5rem;
		flex-wrap: wrap;
	}
	.steps li button {
		color: var(--muted);
	}
	.steps li.on button {
		color: var(--accent);
		font-weight: 600;
	}
	.steps li.done button {
		color: var(--text);
	}
	.newtask {
		border-color: var(--accent);
	}
	.add-more {
		margin-top: 1rem;
	}
</style>
