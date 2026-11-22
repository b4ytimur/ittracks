<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { deserialize, enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { HabitForm, ScheduleForm } from '$lib/forms';
	import OptionList from '$lib/OptionList.svelte';
	import { describeSchedule, weekdayNames } from '$lib/describe';
	import FillRuleEditor from './FillRuleEditor.svelte';
	import NoteBox from '$lib/NoteBox.svelte';
	import { limitOn, nextDrop } from '$lib/engine/limit';
	import { sameSchedule, scheduleStartBy } from '$lib/engine/unlogged';
	import { blocked } from '$lib/rules/core';
	import { checkHabit, habitPast, habitRules } from '$lib/rules/habit';
	import { lockedNow } from '$lib/rules/history';

	let { data, form } = $props();

	type Slot = HabitForm['variants'][number]['slots'][number];

	let h = $state<HabitForm>(untrack(() => structuredClone(data.habit)));
	let mode = $state(untrack(() => data.mode));
	let step = $state(0);
	let pinned = $state(untrack(() => data.pinned));
	let tasks = $state(untrack(() => [...data.tasks]));
	let metricsByTask = $state(untrack(() => ({ ...data.metrics })));
	/** Tasks that log something per set; a Yes or no Task has no sets to aim for. */
	let repeating = $state(untrack(() => new Set(data.repeating)));
	/** History policies (src/lib/rules/history.ts): build or break is fixed once something is logged. */
	const directionLocked = untrack(() => lockedNow(habitPast, 'direction', data.directionLocked));
	/** One raise by steps, per Slot target: "Weight +2.5 kg", in each field's own step and unit. */
	const raiseLines = $derived.by(() => {
		if (h.progression?.unit !== 'steps') return [];
		const by = h.progression.by;
		const out = new Set<string>();
		for (const v of h.variants)
			for (const s of v.slots)
				for (const m of (s.taskId && metricsByTask[s.taskId]) || [])
					if (s.targets[m.id] !== undefined) out.add(`${m.name} +${Math.round(m.step * by * 1000) / 1000}${m.unit ? ` ${m.unit}` : ''}`);
		return [...out];
	});

	// A build habit always has at least one Variant to put Slots in. A group has none: the habits inside it do.
	$effect(() => {
		if (h.direction === 'build' && h.variants.length === 0 && kind !== 'group') addVariant();
	});

	// ----- Schedule editor state, seeded from the saved Schedule -----
	const s0 = untrack(() => data.habit.schedule);
	const savedStart = untrack(() => data.habit.startDate);
	let kind = $state<ScheduleForm['kind']>(s0?.kind ?? 'interval');
	let weeklyDays = $state<Record<string, string>>(s0?.kind === 'weekly' ? { ...s0.days } : {});
	let times = $state(s0?.kind === 'frequency' ? s0.times : 3);
	let period = $state<'week' | 'month'>(s0?.kind === 'frequency' ? s0.period : 'week');
	let every = $state(s0?.kind === 'interval' ? s0.every : 1);
	let singleVariant = $state(s0?.kind === 'frequency' || s0?.kind === 'interval' || s0?.kind === 'follow' ? s0.variantId : '');
	let step_ = $state<'variant' | 'week'>(s0?.kind === 'rotation' ? s0.step : 'variant');
	let onMiss = $state<'wait' | 'skip'>(s0?.kind === 'rotation' ? s0.onMiss : 'wait');
	let restDays = $state<Record<string, number>>(
		s0?.kind === 'rotation' ? Object.fromEntries(s0.order.map((o) => [o.variantId, o.restDays])) : {}
	);
	let weekdays = $state<number[]>(s0?.kind === 'rotation' ? [...s0.weekdays] : [0, 2, 4]);
	let start = $state(
		s0?.kind === 'rotation' || s0?.kind === 'interval' ? s0.start : savedStart
	);
	/** A group: done when all (null) or this many habits inside are done; the Minimum, or none. */
	let groupTarget = $state<number | null>(s0?.kind === 'group' ? s0.target : s0 && 'rollup' in s0 ? (s0.rollup?.target ?? null) : null);
	let groupMinimum = $state<number | null>(s0?.kind === 'group' ? s0.minimum : s0 && 'rollup' in s0 ? (s0.rollup?.minimum ?? null) : null);
	/** Following the routine it sits in: only on these of the routine's Variants, or null for all. */
	let followOn = $state<string[] | null>(s0?.kind === 'follow' ? s0.on : null);
	/** Why the group choice can't be saved as it stands, from what is logged or inside. */
	const groupProblem = $derived(
		kind === 'group' && data.ownLogs
			? 'This habit has logs, and a group gets its days from the habits inside it. Make a new habit for the group instead.'
			: kind !== 'group' && s0?.kind === 'group' && data.inside.length
				? 'Move the habits inside this group out of it first.'
				: null
	);

	const firstVariant = $derived(h.variants[0]?.id ?? '');

	// ----- Routines: a habit with its own schedule and habits inside it -----
	/** The habit this one sits in, as the Inside picker lists it. */
	const parent = $derived(data.groups.find((g) => g.id === h.parentId) ?? null);
	/** This habit holds habits and has days of its own: its day is judged from theirs too. */
	const isRoutine = $derived(h.direction === 'build' && data.inside.length > 0 && kind !== 'group');
	/** Following needs a routine to follow. Leaving it switches to a schedule of its own. */
	$effect(() => {
		if (kind === 'follow' && !parent?.routine) untrack(() => (kind = 'interval'));
	});
	function toggleFollowOn(id: string) {
		const all = parent?.variants.map((v) => v.id) ?? [];
		const now = followOn ?? all;
		const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
		followOn = next.length === all.length ? null : next;
	}
	/** A routine's rule, kept with its schedule only when it isn't the default (all, no Minimum). */
	const routineRule = $derived(isRoutine && (groupTarget !== null || groupMinimum !== null) ? { rollup: { target: groupTarget, minimum: groupMinimum } } : {});

	/**
	 * A new start date for the habit. The schedule's own start follows: along with it when the
	 * two were the same day and nothing is logged yet (a new plan begins on the day you give),
	 * else back far enough to cover it, by whole cycles, so planned days keep their Variant.
	 */
	function setStart(v: string) {
		if (!v) return;
		const old = h.startDate;
		h.startDate = v;
		if (kind !== 'interval' && kind !== 'rotation') return;
		if (start === old && !data.hasLogs) start = v;
		else if (v < start && schedule) start = (scheduleStartBy(schedule, v) as { start: string }).start;
	}

	/** The Schedule as it will be saved. Rotations follow the Variant order. */
	const schedule = $derived.by((): ScheduleForm | null => {
		if (h.direction === 'break') return null;
		const ids = new Set(h.variants.map((v) => v.id));
		const pick = ids.has(singleVariant) ? singleVariant : firstVariant;
		switch (kind) {
			case 'weekly':
				return {
					kind,
					days: Object.fromEntries(Object.entries(weeklyDays).filter(([, v]) => ids.has(v))),
					...routineRule
				};
			case 'frequency':
				return { kind, times, period, variantId: pick, ...routineRule };
			case 'interval':
				return { kind, every, start, variantId: pick, ...routineRule };
			case 'rotation':
				return {
					...routineRule,
					kind,
					step: step_,
					onMiss,
					start,
					weekdays: step_ === 'week' ? [...weekdays].sort() : [],
					order: h.variants.map((v) => ({ variantId: v.id, restDays: restDays[v.id] ?? 1 }))
				};
			case 'group':
				return { kind, target: groupTarget, minimum: groupMinimum };
			case 'follow':
				return { kind, variantId: pick, on: followOn };
		}
	});
	/** A schedule edit on a habit with a past: from today on (the default), or past days too. */
	let scheduleApplies = $state<'today' | 'past'>('today');
	const scheduleEdited = $derived(!data.isNew && !!s0 && !sameSchedule(s0, schedule) && savedStart < data.today);

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
		if (!anchor && !cue.time && !cue.place && !cue.range) return '';
		// Habit names are nouns as often as verbs ("Gym", "Spanish"), so the name leads.
		const place = cue.place && (/^(in|at|on|by|near|under|inside|outside)\s/i.test(cue.place) ? cue.place : `at ${cue.place}`);
		const when = cue.time ? `at ${cue.time}` : cue.range ? `in the ${cue.range.toLowerCase()}` : null;
		const parts = [anchor ? `after ${anchor}` : null, when, place].filter(Boolean);
		return `${h.name.trim() || 'This habit'}: ${parts.join(', ')}.`;
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

	function setTarget(map: Record<string, number>, metricId: string, value: string) {
		if (value === '') delete map[metricId];
		else map[metricId] = Number(value);
	}

	let newPrep = $state('');
	function addPrep() {
		const t = newPrep.trim();
		if (t && !h.prep.includes(t)) h.prep = [...h.prep, t];
		newPrep = '';
	}
	const hasTargets = $derived(h.variants.some((v) => v.slots.some((s) => Object.keys(s.targets).length)));
	const numOrNull = (v: string) => (v === '' ? null : Number(v));

	/** "Today's limit: 10. Drops to 9 on Fri 27 Nov." A changed limit applies from today. */
	const limitPreview = $derived.by(() => {
		if (!h.limit) return '';
		const today = new Date().toLocaleDateString('en-CA');
		const saved = data.habit.limit;
		const unchanged =
			saved &&
			saved.max === h.limit.max &&
			saved.period === h.limit.period &&
			JSON.stringify(saved.taper) === JSON.stringify(h.limit.taper);
		const l = { ...h.limit, start: unchanged ? saved.start : today };
		const per = l.period === 'week' ? 'this week' : 'today';
		const next = nextDrop(l, today);
		const when = (d: string) =>
			new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
		return `Limit ${per}: ${limitOn(l, today)}.${next ? ` Drops to ${next.max} on ${when(next.date)}.` : ''}${unchanged ? '' : ' Changes apply from today.'}`;
	});

	// Text typed into "add" boxes but not added yet still counts when saving.
	const pendingPrep = $derived(newPrep.trim() && !h.prep.includes(newPrep.trim()) ? [newPrep.trim()] : []);
	// ----- Conflict rules (src/lib/rules): what is blocked right now, and why -----
	const ruleForm = $derived({ ...h, schedule, cue } as HabitForm);
	const ruleCheck = $derived(checkHabit(ruleForm));
	const timeBlock = $derived(blocked(habitRules, ruleForm, 'cue.time', {}));
	const rangeBlock = $derived(blocked(habitRules, ruleForm, 'cue.range', {}));
	const remindBlock = $derived(blocked(habitRules, ruleForm, 'remind', {}));
	const uniq = (xs: string[]) => [...new Set(xs)];

	const payload = $derived(
		JSON.stringify({
			...h,
			schedule,
			cue,
			pinned,
			scheduleApplies: scheduleEdited ? scheduleApplies : 'today',
			prep: [...h.prep, ...pendingPrep]
		})
	);

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

	// Features switched off in Settings stay out of the editor unless this habit already uses them.
	const off = (f: string) => data.hidden.includes(f as never);

	// ----- Sections that are off stay folded away until asked for -----
	const has = untrack(() => ({
		when: !!(data.habit.cue.time || data.habit.cue.place || data.habit.cue.afterHabitId || data.habit.cue.afterText || data.habit.cue.range),
		levels: data.habit.levels.enabled,
		streak: (!data.isNew && data.habit.streakRule.kind !== 'neverTwice') || data.habit.unlogged === 'ignore' || !data.habit.minimumCounts,
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
			const t = r.data.newTask as { id: string; name: string; repeats: boolean; metrics: { id: string; name: string; unit: string; step: number }[] };
			tasks = [...tasks, { id: t.id, name: t.name }].sort((a, b) => a.name.localeCompare(b.name));
			metricsByTask = { ...metricsByTask, [t.id]: t.metrics };
			if (t.repeats) repeating = new Set([...repeating, t.id]);
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

	/**
	 * Save without reloading the page. A refused save (a conflict, a missing field) keeps
	 * everything typed in, new habit or not, and brings the reason into view.
	 */
	const keepOnError: SubmitFunction = () => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type !== 'failure') return;
		await tick();
		document.querySelector('#habit-form .save-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	};

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
					{#if s.taskId && !repeating.has(s.taskId) && data.withParts.includes(s.taskId)}
						<label style="width: 8rem" title="Everything inside this Task is logged once per round"
							>Rounds
							<input
								type="number"
								min="0"
								max="50"
								value={s.sets ?? ''}
								oninput={(e) => (s.sets = e.currentTarget.value ? Number(e.currentTarget.value) : null)}
							/>
						</label>
					{:else if !s.taskId || repeating.has(s.taskId)}
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
					{/if}
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

			{#if isRoutine}
				<p class="muted small-text" style="margin: 0">Its Tasks are the habits inside it, so it has none of its own for now.</p>
			{:else}
			<div class="row">
				{#if tasks.length}
					<button type="button" onclick={() => addSlot(v.slots, false)}>Add a Task</button>
				{:else}
					<button type="button" onclick={() => { addSlot(v.slots, false); newTaskFor = v.slots.at(-1)!.id; }}>Add a new Task</button>
				{/if}
				<button type="button" onclick={() => addSlot(v.slots, true)}>Add an auto-filled slot</button>
			</div>
			{/if}
			{#if !v.slots.length && !isRoutine}
				<p class="muted small-text" style="margin: 0">No Tasks means there's nothing to fill in: you just tick it off.</p>
			{/if}
		</div>
	{/each}
	<button type="button" onclick={addVariant}
		>{h.variants.length > 1 ? 'Add a Variant' : 'Add another Variant (for A/B plans)'}</button
	>
{/snippet}

{#snippet schedulePart()}
	{#if kind !== 'group'}
	<div class="chips" role="group" aria-label="Quick schedules">
		<button type="button" class="chip" class:on={presetOn === 'daily'} onclick={() => applyPreset('daily')}>Every day</button>
		<button type="button" class="chip" class:on={presetOn === 'weekdays'} onclick={() => applyPreset('weekdays')}>Weekdays</button>
		<button type="button" class="chip" class:on={presetOn === 'mwf'} onclick={() => applyPreset('mwf')}>Mon, Wed, Fri</button>
		<button type="button" class="chip" class:on={presetOn === 'three'} onclick={() => applyPreset('three')}>3 times a week</button>
		<button type="button" class="chip" class:on={presetOn === 'ab'} onclick={() => applyPreset('ab')}>A/B with 1 rest day</button>
	</div>
	{/if}
	<label
		>How often
		<select bind:value={kind}>
			<option value="weekly">On fixed weekdays</option>
			<option value="frequency">A number of times per week or month</option>
			<option value="interval">Every few days</option>
			<option value="rotation">Rotate through Variants</option>
			<option value="group">From the habits inside it (a group)</option>
			{#if parent?.routine}<option value="follow">Whenever {parent.name} is due</option>{/if}
		</select>
	</label>
	{#if groupProblem}<p class="error small-text">{groupProblem}</p>{/if}

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
	{:else if kind === 'group'}
		<p class="muted small-text" style="margin: 0">
			A group has no Tasks of its own. It is due on days a habit inside it is due, and its streak counts the days enough of them were done.
		</p>
		<label
			>Done when
			<select
				value={groupTarget === null ? 'all' : 'some'}
				onchange={(e) => (groupTarget = e.currentTarget.value === 'all' ? null : Math.max(1, Math.min(groupMinimum !== null ? groupMinimum + 1 : 2, 100)))}
			>
				<option value="all">Every habit inside that is due is done</option>
				<option value="some">A number of them are done</option>
			</select>
		</label>
		{#if groupTarget !== null}
			<label style="width: 10rem">How many <input type="number" min="1" max="100" bind:value={groupTarget} /></label>
		{/if}
		<label style="color: var(--text)"
			><input type="checkbox" checked={groupMinimum !== null} onchange={(e) => (groupMinimum = e.currentTarget.checked ? 1 : null)} /> A day with fewer done still counts at the Minimum</label
		>
		{#if groupMinimum !== null}
			<label style="width: 10rem">Habits for the Minimum <input type="number" min="1" max="100" bind:value={groupMinimum} /></label>
		{/if}
		<p class="muted small-text" style="margin: 0">
			{#if data.inside.length}
				Inside: {data.inside.map((x) => x.name + (x.archived ? ' (archived)' : '')).join(', ')}.
			{:else}
				Nothing inside yet. Open a habit and pick this group under Inside.
			{/if}
			On a day only some are due, "a number" means that many of the ones due.
		</p>
	{:else if kind === 'follow' && parent}
		<p class="muted small-text" style="margin: 0">
			Due on {parent.name}'s days{followOn ? ', with the Variants picked here' : ''}. On Today it shows inside {parent.name}, and marking
			{parent.name} done marks this done too.
		</p>
		{#if parent.variants.length > 1}
			<span class="muted small-text">Only when {parent.name} is on</span>
			<div class="chips" role="group" aria-label="{parent.name}'s Variants">
				{#each parent.variants as pv (pv.id)}
					<button type="button" class="chip small" class:on={!followOn || followOn.includes(pv.id)} onclick={() => toggleFollowOn(pv.id)}>{pv.name}</button>
				{/each}
			</div>
		{/if}
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

	{#if isRoutine}
		<fieldset class="card">
			<legend class="muted">On its days, judged from the habits inside</legend>
			<label
				>Done when
				<select
					value={groupTarget === null ? 'all' : 'some'}
					onchange={(e) => (groupTarget = e.currentTarget.value === 'all' ? null : Math.max(1, Math.min(groupMinimum !== null ? groupMinimum + 1 : 2, 100)))}
				>
					<option value="all">Every habit inside that is due is done</option>
					<option value="some">A number of them are done</option>
				</select>
			</label>
			{#if groupTarget !== null}
				<label style="width: 10rem">How many <input type="number" min="1" max="100" bind:value={groupTarget} /></label>
			{/if}
			<label style="color: var(--text)"
				><input type="checkbox" checked={groupMinimum !== null} onchange={(e) => (groupMinimum = e.currentTarget.checked ? 1 : null)} /> A day with fewer done still counts at the Minimum</label
			>
			{#if groupMinimum !== null}
				<label style="width: 10rem">Habits for the Minimum <input type="number" min="1" max="100" bind:value={groupMinimum} /></label>
			{/if}
			<p class="muted small-text" style="margin: 0">
				Inside: {data.inside.map((x) => x.name + (x.archived ? ' (archived)' : '')).join(', ')}. Done on Today marks the ones due done; a day none of
				them is due, you tick it off like any habit.
			</p>
		</fieldset>
	{/if}

	{#if (kind === 'frequency' || kind === 'interval' || kind === 'follow') && h.variants.length > 1}
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
			<input type="time" value={h.cue.time ?? ''} disabled={!!timeBlock}
				oninput={(e) => (h.cue.time = e.currentTarget.value || null)} />
		</label>
		{#if data.ranges.length}
			<label class="grow"
				>Or part of the day
				<select value={h.cue.range ?? ''} disabled={!!rangeBlock} onchange={(e) => (h.cue.range = e.currentTarget.value || null)}>
					<option value="">Any</option>
					{#each data.ranges as r (r.name)}<option value={r.name}>{r.name} ({r.start}–{r.end})</option>{/each}
				</select>
			</label>
		{/if}
	</div>
	{#if timeBlock}
		<p class="blocked">{timeBlock.reason}. <button type="button" class="link" onclick={() => (h.cue.range = null)}>Use a time instead</button></p>
	{:else if rangeBlock && data.ranges.length}
		<p class="blocked">{rangeBlock.reason}. <button type="button" class="link" onclick={() => (h.cue.time = null)}>Use a part of the day instead</button></p>
	{/if}
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
		><input type="checkbox" bind:checked={h.remind} disabled={!!remindBlock && !h.remind} title={remindBlock?.reason} /> Remind me {h.cue.time ? 'at this time' : h.cue.range ? `when the ${h.cue.range.toLowerCase()} starts` : `(${remindBlock?.reason.toLowerCase() ?? 'set a time first'})`}</label
	>
	{#if h.remind}
		<p class="muted small-text">Turn on reminders for this device in <a href="/settings/reminders">Settings</a>.</p>
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
			><input type="radio" bind:group={h.direction} value="build" disabled={!!directionLocked && h.direction !== 'build'} /> Build: something to do</label
		>
		<label style="color: var(--text)"
			><input type="radio" bind:group={h.direction} value="break" disabled={!!directionLocked && h.direction !== 'break'} /> Break: something to stop, with
			a slip counter</label
		>
		{#if directionLocked}<p class="muted small-text" style="margin: 0.25rem 0 0">{directionLocked}.</p>{/if}
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

{#snippet insidePart()}
	{#if h.direction === 'build' && (data.groups.length || h.parentId)}
		{@const groupsOnly = data.groups.filter((g) => !g.routine)}
		<!-- A group is judged, never marked, so it can't sit in a routine (whose Done marks what is inside). -->
		{@const routines = kind === 'group' ? [] : data.groups.filter((g) => g.routine)}
		<label
			>Inside
			<select bind:value={h.parentId}>
				<option value={null}>Not inside another habit</option>
				{#if groupsOnly.length}
					<optgroup label="Groups">
						{#each groupsOnly as g (g.id)}<option value={g.id}>{g.name}{g.archived ? ' (archived)' : ''}</option>{/each}
					</optgroup>
				{/if}
				{#if routines.length}
					<optgroup label="Routines (habits with no Tasks of their own)">
						{#each routines as g (g.id)}<option value={g.id}>{g.name}{g.archived ? ' (archived)' : ''}</option>{/each}
					</optgroup>
				{/if}
			</select>
		</label>
		{#if parent}
			<p class="muted small-text" style="margin-top: -0.25rem">
				{#if parent.routine}
					On Today it shows inside {parent.name}, and {parent.name}'s days count it. Under How often it can follow {parent.name}'s days.
				{:else}
					On Today it shows inside its group, and the group's days count it.
				{/if}
			</p>
		{/if}
	{/if}
{/snippet}

{#snippet startPart()}
	{#if scheduleEdited}
		<fieldset class="card">
			<legend class="muted">This schedule change applies</legend>
			<label style="color: var(--text)"
				><input type="radio" bind:group={scheduleApplies} value="today" /> From today on: earlier days keep the plan they had</label
			>
			<label style="color: var(--text)"
				><input type="radio" bind:group={scheduleApplies} value="past" /> To past days too: the plan was wrong from the start</label
			>
			<p class="muted small-text" style="margin: 0.25rem 0 0">
				{scheduleApplies === 'past'
					? 'Missed days are counted again with the new schedule, from Started on. Everything you logged stays.'
					: 'Misses already counted stay, and logging a past day later judges it by the schedule it had then.'}
			</p>
		</fieldset>
	{/if}
	<label
		>Started on
		<input type="date" value={h.startDate} onchange={(e) => setStart(e.currentTarget.value)} required />
	</label>
	<p class="muted small-text" style="margin-top: -0.25rem">
		Days from here on can be logged. {h.startDate > data.today
			? 'Nothing is due before then.'
			: h.startDate < data.today && h.startDate !== savedStart
				? 'Due days you leave unlogged count as missed, unless you change that under Streak.'
				: ''}
	</p>
{/snippet}

{#snippet breakPart()}
	<label>Counting from <input type="date" bind:value={h.startDate} required /></label>
	<p class="muted">
		{#if h.limit}
			You have a limit set below. Log each one as it happens; the counter shows how many days in a
			row you stayed within the limit.
		{:else}
			The habit shows the days since your last slip. Log a slip whenever it happens and the counter
			goes back to 0. To cut down instead of quitting, set a limit below.
		{/if}
	</p>

	{#if !off('ifThen') || h.ifThen.when || h.ifThen.then}
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
	{/if}

	<h2>Slip triggers</h2>
	<p class="muted">Feelings you can pick when you log a slip. Over time Today shows which ones come up most.</p>
	<OptionList
		bind:options={h.triggers}
		used={(id) => data.usedFeelings.includes(id)}
		label="Feeling"
		addLabel="Add feeling"
		placeholder="e.g. Stressed"
		usedTitle="Past slips were logged with it: they keep it, and a rename shows there too"
	/>

	{#if !off('cost')}
	<h2>Cost</h2>
	<label style="color: var(--text)"
		><input
			type="checkbox"
			checked={!!h.cost}
			onchange={(e) => (h.cost = e.currentTarget.checked ? { amount: 1, unit: '€', perDay: null } : null)}
		/> Show what slips cost and what staying clean saves</label
	>
	{#if h.cost}
		<div class="row">
			<label style="width: 7rem">Cost per slip <input type="number" min="0" step="any" bind:value={h.cost.amount} /></label>
			<label style="width: 6rem">Unit <input bind:value={h.cost.unit} placeholder="€, kcal, min" /></label>
			<label class="grow"
				>Slips a day before you started
				<input type="number" min="0" step="any" value={h.cost.perDay ?? ''}
					oninput={(e) => h.cost && (h.cost.perDay = numOrNull(e.currentTarget.value))} placeholder="optional, e.g. 10" />
			</label>
		</div>
	{/if}
	{/if}

	<h2>Reduce instead of quitting</h2>
	<label style="color: var(--text)"
		><input
			type="checkbox"
			checked={!!h.limit}
			onchange={(e) =>
				(h.limit = e.currentTarget.checked
					? { max: 3, period: 'day', taper: null, start: h.startDate }
					: null)}
		/> Allow up to a limit; the counter tracks days within it</label
	>
	{#if h.limit}
		<div class="row">
			<label style="width: 6rem">Up to <input type="number" min="0" max="1000" bind:value={h.limit.max} /></label>
			<label class="grow"
				>Per
				<select bind:value={h.limit.period}>
					<option value="day">day</option>
					<option value="week">week</option>
				</select>
			</label>
		</div>
		<label style="color: var(--text)"
			><input
				type="checkbox"
				checked={!!h.limit.taper}
				onchange={(e) => h.limit && (h.limit.taper = e.currentTarget.checked ? { by: 1, every: 'week', floor: 0 } : null)}
			/> Lower the limit over time</label
		>
		{#if h.limit.taper}
			<div class="row">
				<label style="width: 6rem">By <input type="number" min="1" max="100" bind:value={h.limit.taper.by} /></label>
				<label class="grow"
					>Every
					<select bind:value={h.limit.taper.every}>
						<option value="week">week</option>
						<option value="month">month</option>
					</select>
				</label>
				<label style="width: 7rem">Down to <input type="number" min="0" max="1000" bind:value={h.limit.taper.floor} /></label>
			</div>
		{/if}
		{#if limitPreview}<p class="muted small-text">{limitPreview}</p>{/if}
	{/if}
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
		{#if !data.hidden.includes('journal')}
			<li><a class="card" href="/journal?setup"><strong>Start a daily journal</strong><div class="muted small-text">A few lines each evening with a prompt, a mood to chart, and an optional day note on Today.</div></a></li>
		{/if}
	</ul>
	<p class="muted small-text">You can skip this choice in <a href="/settings/editor">Settings</a>.</p>
{:else}
<header class="bar">
	<h1>{data.isNew ? (data.copiedFrom ? `Copy of ${data.copiedFrom}` : 'New habit') : 'Edit habit'}</h1>
	<div class="row">
		{#if !data.isNew}
			<a href="/habits/{data.id}/chain">Chain</a>
			<a href="/habits/{data.id}/stats">Stats</a>
			<a href="/habits/new?from={data.id}" data-sveltekit-reload>Duplicate</a>
			{#if s0?.kind !== 'group'}<a href="/habits/{data.id}/share">Share as template</a>{/if}
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

{#if data.fixed.length}
	<p class="card blocked" style="margin-bottom: 1rem">
		Some options on this habit blocked each other, so we fixed them: {data.fixed.join('; ')}. Save to keep this.
	</p>
{/if}

<form method="POST" action="?/save" class="stack" id="habit-form" use:enhance={keepOnError}>
	<input type="hidden" name="payload" value={payload} />

	{#if mode === 'guided'}
		<ol class="steps" aria-label="Steps">
			{#each guidedSteps as g, gi (g)}
				<li class:on={gi === step} class:done={gi < step}><button type="button" class="link" onclick={() => (step = gi)} disabled={gi > step && !canNext}>{gi + 1}. {g}</button></li>
			{/each}
		</ol>

		{#if step === 0}
			<label>What's the habit called? <input bind:value={h.name} placeholder="Gym, Spanish, Read" maxlength="120" required /></label>
			{@render typePart()}
			{@render areaPart()}
			{@render insidePart()}
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

		{#if form?.error}<p class="error save-error" role="alert">{form.error}</p>{/if}
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
	<label>Name <input bind:value={h.name} placeholder="Gym, Read, Spanish" maxlength="120" required /></label>

	{@render typePart()}
	{@render areaPart()}
	{@render insidePart()}

	{#if h.direction === 'break'}
		{@render breakPart()}
	{:else}
		{#if kind !== 'group'}
			<h2>{h.variants.length > 1 ? 'Variants' : 'What you do'}</h2>
			{@render whatYouDo()}
		{/if}

		<h2>Schedule</h2>
		{@render schedulePart()}
		{@render startPart()}

		{#if open.when}
			<h2>When and where</h2>
			<p class="muted">Optional. A clear time and place make a habit easier to start.</p>
			{@render cuePart()}
		{/if}

		{#if open.levels && kind !== 'group' && (!off('levels') || h.levels.enabled)}
			<h2>Levels</h2>
			<label style="color: var(--text)"
				><input type="checkbox" bind:checked={h.levels.enabled} /> Use levels: a two-minute Minimum, your Target, and a Stretch</label
			>
			{#if h.levels.enabled}
				<label>Minimum <input bind:value={h.levels.minimum} placeholder="Put on running shoes" /></label>
				<label>Target <input bind:value={h.levels.target} placeholder="Run 5 km" /></label>
				<label>Stretch <input bind:value={h.levels.stretch} placeholder="Run 10 km" /></label>
				<p class="muted small-text">Set numbers for each level per Task in the Slots above. Whether a Minimum day counts is under Streak.</p>
			{/if}
		{/if}
		{#if kind !== 'group' && h.variants.some((v) => v.slots.length)}
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
			{#if h.direction === 'build' && (kind !== 'group' || groupMinimum !== null)}
				<fieldset class="card">
					<legend class="muted">A day that falls short of the target</legend>
					<label style="color: var(--text)"
						><input type="radio" bind:group={h.minimumCounts} value={true} />
						{kind === 'group' ? `Counts once ${groupMinimum} inside are done` : h.levels.enabled ? 'Counts once it reaches the Minimum' : 'Counts once anything is logged'}</label
					>
					<label style="color: var(--text)"
						><input type="radio" bind:group={h.minimumCounts} value={false} /> Only the full target counts</label
					>
					<p class="muted small-text" style="margin: 0.25rem 0 0" hidden={kind === 'group'}>
						{h.minimumCounts
							? h.levels.enabled
								? 'Doing the Minimum keeps the streak alive. Less than that is a miss once the day is over.'
								: '5 of 6 glasses is a done day, shown as "Done · 5 of 6 glasses".'
							: 'Good for medication: 1 of 2 doses is a miss once the day is over, shown as "Missed · 1 of 2 steps".'}
						What you logged always stays in History and Stats.
					</p>
				</fieldset>
			{/if}
			{#if kind !== 'group'}
			<fieldset class="card">
				<legend class="muted">Days you don't log</legend>
				<label style="color: var(--text)"
					><input type="radio" bind:group={h.unlogged} value="missed" /> Count as missed once the day is over</label
				>
				<label style="color: var(--text)"
					><input type="radio" bind:group={h.unlogged} value="ignore" /> Don't count them: only what you log counts</label
				>
				<p class="muted small-text" style="margin: 0.25rem 0 0">
					{h.unlogged === 'ignore'
						? 'A day you forget leaves your streak and consistency as they were. Logging it later still counts.'
						: 'Streaks, consistency, the chain and Stats treat a forgotten day as a miss. Log or skip it later to change that.'}
				</p>
			</fieldset>
			{/if}
		{/if}

		<details class="extras" open={!!(h.bundle.reward || h.prep.length || h.reward.celebrate || h.reward.jar || h.progression)}>
			<summary>More ways to make it stick (optional)</summary>
		{#if !off('rewards') || h.bundle.reward}
	<h3>Pair it with something you enjoy</h3>
		<label
			>Pair with
			<input bind:value={h.bundle.reward} placeholder="my favourite podcast" />
		</label>
		{#if h.bundle.reward}
			<label style="color: var(--text)"
				><input type="checkbox" bind:checked={h.bundle.strict} /> Save it as a treat for after the habit is done</label
			>
		{/if}
	{/if}

	{#if !off('prep') || h.prep.length}
	<h3>Prepare the day before</h3>
		<p class="muted">Steps that make tomorrow easier. They show on Today the day before this habit is due.</p>
		{#each h.prep as item, pi (item)}
			<div class="row">
				<span class="grow">{item}</span>
				<button type="button" class="small danger" onclick={() => h.prep.splice(pi, 1)}>Remove</button>
			</div>
		{/each}
		<div class="row">
			<input class="grow" bind:value={newPrep} placeholder="Lay out gym clothes" aria-label="New prep step"
				onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addPrep())} />
			<button type="button" onclick={addPrep}>Add</button>
		</div>
	{/if}

	{#if !off('rewards') || h.reward.celebrate || h.reward.jar}
		<h3>Reward</h3>
		<label style="color: var(--text)"
			><input type="checkbox" bind:checked={h.reward.celebrate} /> Celebrate when I finish</label
		>
		{#if h.reward.celebrate}
			<label>Message <input bind:value={h.reward.message} placeholder="Another vote for the runner you are" /></label>
		{/if}
		<label style="color: var(--text)"
			><input
				type="checkbox"
				checked={!!h.reward.jar}
				onchange={(e) => (h.reward.jar = e.currentTarget.checked ? { amount: 2, unit: '€', goal: '' } : null)}
			/> Fill a jar toward a reward</label
		>
		{#if h.reward.jar}
			<div class="row">
				<label style="width: 7rem">Each time, add <input type="number" min="0" step="any" bind:value={h.reward.jar.amount} /></label>
				<label style="width: 5rem">Unit <input bind:value={h.reward.jar.unit} placeholder="€, points" /></label>
				<label class="grow">Saving for <input bind:value={h.reward.jar.goal} placeholder="new running shoes" /></label>
			</div>
			<p class="muted small-text">A pretend jar that fills up as you go. Treat yourself when it's full.</p>
		{/if}
		{/if}
		{#if hasTargets && (!off('progression') || h.progression)}
			<h3>Progression</h3>
			<label style="color: var(--text)"
				><input
					type="checkbox"
					checked={!!h.progression}
					onchange={(e) => (h.progression = e.currentTarget.checked ? { after: 6, by: 5, unit: 'percent' } : null)}
				/> Suggest raising my targets when I keep hitting them</label
			>
			{#if h.progression}
				<div class="row">
					<label style="width: 8rem">After hitting them <input type="number" min="2" max="60" bind:value={h.progression.after} /></label>
					<span style="padding-bottom: 0.6rem">times in a row, raise by</span>
					<label style="width: 5rem"><input type="number" min="0" step="any" bind:value={h.progression.by} aria-label="Raise by" /></label>
					<label style="width: 7rem"
						><select bind:value={h.progression.unit} aria-label="Raise unit">
							<option value="percent">%</option>
							<option value="steps">steps</option>
						</select></label
					>
				</div>
				{#if h.progression.unit === 'steps'}
					<p class="muted small-text">
						A step is each field's own +/− step, in its own unit{raiseLines.length ? `: ${raiseLines.join(', ')}` : ''}. Change a step in the Task's “When logging”.
					</p>
				{/if}
				<p class="muted small-text">ittracks only suggests it. Nothing changes until you accept.</p>
			{/if}
		{/if}
		</details>
	{/if}

	{#if !off('reframe') || h.reframe}
	<h2>Reframe</h2>
	<label
		>A line to see on the card
		<input bind:value={h.reframe} placeholder={h.direction === 'break' ? 'I am free of this' : 'I get to do this today'} />
	</label>
	{/if}

	{#if open.identity && (!off('identities') || h.identityIds.length)}
		<h2>Identity</h2>
		{@render identityPart()}
	{/if}

	{#if open.notes}
		<NoteBox bind:value={h.notes} label="Notes" hint="Markdown: why this habit matters, the plan, links." />
	{/if}

	{#if Object.values(open).some((x) => !x)}
		<div class="chips add-more">
			{#if h.direction === 'build' && !open.when}<button type="button" class="chip" onclick={() => (open.when = true)}>+ When and where</button>{/if}
			{#if h.direction === 'build' && kind !== 'group' && !open.levels && !off('levels')}<button type="button" class="chip" onclick={() => (open.levels = true)}>+ Levels</button>{/if}
			{#if h.direction === 'build' && !open.streak}<button type="button" class="chip" onclick={() => (open.streak = true)}>+ Streak and days you don't log</button>{/if}
			{#if !open.identity && !off('identities')}<button type="button" class="chip" onclick={() => (open.identity = true)}>+ Identity</button>{/if}
			{#if !open.notes}<button type="button" class="chip" onclick={() => (open.notes = true)}>+ Notes</button>{/if}
		</div>
	{/if}

	{#if h.direction === 'build' && kind !== 'group'}
		<label style="color: var(--text)"><input type="checkbox" bind:checked={pinned} /> Add to home screen shortcuts (long-press the app icon)</label>
		{#if !data.isNew}
			<p class="muted small-text" style="margin: 0">
				Quick-log link for bookmarks or a QR code: <a href="/q/{data.id}">/q/{data.id.slice(0, 8)}…</a>. Add <code>?go=1</code> to log "same as last time" in one tap.
			</p>
		{/if}
	{/if}

	{#each uniq(ruleCheck.errors.map((i) => i.reason)) as reason (reason)}<p class="error">{reason}</p>{/each}
	{#each uniq(ruleCheck.warnings.map((i) => i.reason)) as reason (reason)}<p class="blocked">Heads up: {reason}</p>{/each}
	{#if form?.error}<p class="error save-error" role="alert">{form.error}</p>{/if}

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
		<p class="muted small-text" style="margin: 0">Paused days aren't due and never break the streak. For a break from every habit, use <a href="/settings/vacation">Vacation</a> in Settings.</p>
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
	.extras {
		margin-top: 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.6rem 0.9rem;
	}
	.extras > * + * {
		margin-top: 0.6rem;
	}
	.extras summary {
		cursor: pointer;
		font-weight: 600;
	}
	.extras h3 {
		font-size: 1rem;
		margin: 1rem 0 0.25rem;
	}
	.slot {
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}
	fieldset {
		border: 1px solid var(--border);
	}
	.blocked {
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0;
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
