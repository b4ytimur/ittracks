<script lang="ts">
	import { untrack } from 'svelte';
	import { deserialize } from '$app/forms';
	import type { HabitForm, ScheduleForm } from '$lib/forms';
	import { weekdayNames } from '$lib/describe';
	import FillRuleEditor from './FillRuleEditor.svelte';

	let { data, form } = $props();

	type Slot = HabitForm['variants'][number]['slots'][number];

	let h = $state<HabitForm>(untrack(() => structuredClone(data.habit)));

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
	let step = $state<'variant' | 'week'>(s0?.kind === 'rotation' ? s0.step : 'variant');
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
					step,
					onMiss,
					start,
					weekdays: step === 'week' ? [...weekdays].sort() : [],
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
		afterText: afterMode === 'text' ? h.cue.afterText?.trim() || null : null
	});
	const intention = $derived.by(() => {
		const anchor = cue.afterHabitId
			? data.habits.find((x) => x.id === cue.afterHabitId)?.name
			: cue.afterText;
		const what = h.name.trim() || 'do this';
		let line = `${anchor ? `After ${anchor}, I` : 'I'} will ${what}`;
		if (cue.time) line += ` at ${cue.time}`;
		if (cue.place) line += ` ${cue.place}`;
		return anchor || cue.time || cue.place ? `${line}.` : '';
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

	let newPrep = $state('');
	function addPrep() {
		const t = newPrep.trim();
		if (t && !h.prep.includes(t)) h.prep = [...h.prep, t];
		newPrep = '';
	}
	const hasTargets = $derived(h.variants.some((v) => v.slots.some((s) => Object.keys(s.targets).length)));
	const numOrNull = (v: string) => (v === '' ? null : Number(v));

	const payload = $derived(JSON.stringify({ ...h, schedule, cue }));

	function addVariant() {
		const letter = String.fromCharCode(65 + h.variants.length);
		h.variants.push({ id: crypto.randomUUID(), name: letter, slots: [] });
	}

	function addSlot(slots: Slot[], open: boolean) {
		slots.push({
			id: crypto.randomUUID(),
			taskId: open ? null : (data.tasks[0]?.id ?? null),
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

<header class="bar">
	<h1>{data.isNew ? 'New habit' : 'Edit habit'}</h1>
	<div class="row">
		{#if !data.isNew}<a href="/habits/{data.id}/chain">Chain</a>{/if}
		{#if !data.isNew}<a href="/habits/{data.id}/template.json" download>Export template</a>{/if}
		<a href="/habits">Cancel</a>
	</div>
</header>

<form method="POST" action="?/save" class="stack">
	<input type="hidden" name="payload" value={payload} />

	<label>Name <input bind:value={h.name} placeholder="Gym" required /></label>

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

	{#if h.direction === 'break'}
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
					onchange={(e) => h.limit && (h.limit.taper = e.currentTarget.checked ? { by: 1, every: 'week' } : null)}
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
				</div>
			{/if}
		{/if}
	{:else}
		<h2>{h.variants.length > 1 ? 'Variants' : 'What you do'}</h2>
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
						<button type="button" class="small danger" onclick={() => h.variants.splice(vi, 1)}>Remove</button>
					</div>
				{/if}

				{#each v.slots as s, si (s.id)}
					<div class="slot stack">
						<div class="row">
							<strong class="grow">Slot {si + 1}</strong>
							<button type="button" class="small" onclick={() => move(v.slots, si, -1)} aria-label="Move up">↑</button>
							<button type="button" class="small" onclick={() => move(v.slots, si, 1)} aria-label="Move down">↓</button>
							<button type="button" class="small danger" onclick={() => v.slots.splice(si, 1)}>Remove</button>
						</div>
						{#if s.fillRule}
							<FillRuleEditor bind:rule={s.fillRule} tags={data.tags} />
						{:else}
							<label
								>Task
								<select bind:value={s.taskId} required>
									{#each data.tasks as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
								</select>
							</label>
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
						{#if !s.fillRule && s.taskId && data.metrics[s.taskId]?.length}
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
									{#each data.metrics[s.taskId] as m (m.id)}
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
					<button type="button" onclick={() => addSlot(v.slots, false)} disabled={data.tasks.length === 0}
						>Add a Task</button
					>
					<button type="button" onclick={() => addSlot(v.slots, true)}>Add an auto-filled slot</button>
				</div>
				{#if data.tasks.length === 0}
					<p class="muted">Your Library is empty. <a href="/library/new">Add a Task</a> first.</p>
				{/if}
			</div>
		{/each}
		<button type="button" onclick={addVariant}
			>{h.variants.length > 1 ? 'Add a Variant' : 'Add another Variant (for A/B plans)'}</button
		>

		<h2>Schedule</h2>
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
				<select bind:value={step}>
					<option value="variant">Variant, with rest days between them</option>
					<option value="week">Week: a different Variant each week</option>
				</select>
			</label>
			{#if step === 'variant'}
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

		<h2>When and where</h2>
		<p class="muted">Optional. A clear time and place make a habit easier to start.</p>
		<div class="row">
			<label style="width: 8rem"
				>Time
				<input type="time" value={h.cue.time ?? ''} oninput={(e) => (h.cue.time = e.currentTarget.value || null)} />
			</label>
			<label class="grow"
				>Where <input value={h.cue.place ?? ''} oninput={(e) => (h.cue.place = e.currentTarget.value)} placeholder="in the park" />
			</label>
		</div>
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
			><input type="checkbox" bind:checked={h.remind} disabled={!h.cue.time} /> Remind me at this time</label
		>
		{#if h.remind}
			<p class="muted small-text">Turn on reminders for this device in <a href="/settings">Settings</a>.</p>
		{/if}

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
		{#if h.variants.some((v) => v.slots.length)}
			<label style="color: var(--text)"
				><input type="checkbox" bind:checked={h.quickDone} /> One-tap Done on Today (logs your targets)</label
			>
		{/if}

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

		<h2>Pair it with something you enjoy</h2>
		<label
			>Pair with
			<input bind:value={h.bundle.reward} placeholder="my favourite podcast" />
		</label>
		{#if h.bundle.reward}
			<label style="color: var(--text)"
				><input type="checkbox" bind:checked={h.bundle.strict} /> Only after the habit is done</label
			>
		{/if}

		<h2>Prepare the day before</h2>
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

		<h2>Reward</h2>
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
				<label style="width: 6rem">Add <input type="number" min="0" step="any" bind:value={h.reward.jar.amount} /></label>
				<label style="width: 5rem">Unit <input bind:value={h.reward.jar.unit} /></label>
				<label class="grow">Toward <input bind:value={h.reward.jar.goal} placeholder="new running shoes" /></label>
			</div>
		{/if}

		{#if hasTargets}
			<h2>Progression</h2>
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
							<option value="amount">units</option>
						</select></label
					>
				</div>
				<p class="muted small-text">ittracks only suggests it. Nothing changes until you accept.</p>
			{/if}
		{/if}
	{/if}

	<h2>Reframe</h2>
	<label
		>A line to see on the card
		<input bind:value={h.reframe} placeholder={h.direction === 'break' ? 'I am free of this' : 'I get to do this today'} />
	</label>

	<h2>Identity</h2>
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

	<label>Notes <textarea bind:value={h.notes} rows="2"></textarea></label>

	{#if form?.error}<p class="error">{form.error}</p>{/if}

	<div class="actions">
		<button class="primary">Save habit</button>
		{#if !data.isNew}
			<button
				class="danger"
				formaction="?/delete"
				formnovalidate
				onclick={(e) => !confirm('Delete this habit and its history?') && e.preventDefault()}
				>Delete</button
			>
		{/if}
	</div>
</form>

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
</style>
