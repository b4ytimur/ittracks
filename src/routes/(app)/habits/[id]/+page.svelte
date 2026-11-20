<script lang="ts">
	import { untrack } from 'svelte';
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
	const payload = $derived(JSON.stringify({ ...h, schedule }));

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
			targets: {}
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
	<a href="/habits">Cancel</a>
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
	{/if}

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
</style>
