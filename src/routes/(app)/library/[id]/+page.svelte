<script lang="ts">
	import { metricTypes } from '$lib/metric-types';
	import CardGrid from '$lib/stats/ui/CardGrid.svelte';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import type { MetricForm, TaskForm } from '$lib/forms';
	import { defaultStep, metricsFromType, type TaskType } from '$lib/task-types';
	import { blocked } from '$lib/rules/core';
	import { checkTask, metricRules, taskRules } from '$lib/rules/task';

	let { data, form } = $props();

	// The editor works on a local copy; the whole thing is sent as JSON on save.
	let t = $state<TaskForm>(untrack(() => structuredClone(data.task)));
	let newTag = $state('');

	// Conflict rules (src/lib/rules): what is blocked right now, and why.
	const ruleCheck = $derived(checkTask(t));
	const restBlock = $derived(blocked(taskRules, t, 'restTimerEnabled', undefined));
	const quickBlock = (m: MetricForm) => blocked(metricRules, m, 'quick', undefined);
	const prefillBlock = (m: MetricForm) => blocked(metricRules, m, 'prefill', undefined);
	let newLevel = $state(2);

	const typeLabels: Record<string, string> = {
		number: 'Number (e.g. weight)',
		count: 'Count (e.g. reps)',
		duration: 'Duration (minutes)',
		checkbox: 'Checkbox (done?)',
		choice: 'Choice (pick one)',
		text: 'Text (notes)'
	};

	function addTag() {
		const name = newTag.trim();
		if (!name || t.tags.some((g) => g.name.toLowerCase() === name.toLowerCase())) return;
		t.tags.push({ name, level: newLevel });
		newTag = '';
	}

	function addMetric(preset?: Partial<MetricForm>) {
		t.metrics.push({
			id: crypto.randomUUID(),
			name: '',
			type: 'number',
			unit: '',
			repeats: false,
			choices: [],
			prefill: 'last',
			step: null,
			required: false,
			quick: true,
			...preset
		});
	}

	/** Start from a Task type: its fields replace the current ones. */
	let typeKey = $state('');
	function applyType(type: TaskType) {
		typeKey = type.key;
		t.metrics = metricsFromType(type, data.weightUnit);
		t.restTimerEnabled = type.restTimerEnabled;
	}

	let typeName = $state('');
	const typePayload = $derived(
		JSON.stringify({
			name: typeName,
			restTimerEnabled: t.restTimerEnabled,
			metrics: t.metrics.map((m) => ({ name: m.name, type: m.type, unit: m.unit, repeats: m.repeats, step: m.step }))
		})
	);

	const toggleCollection = (id: string) =>
		(t.collectionIds = t.collectionIds.includes(id) ? t.collectionIds.filter((x) => x !== id) : [...t.collectionIds, id]);
	const isNumeric = (m: MetricForm) => m.type === 'number' || m.type === 'count' || m.type === 'duration';
	const ago = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

	function move<T>(list: T[], i: number, by: number) {
		const j = i + by;
		if (j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j], list[i]];
	}
</script>

<svelte:head><title>{data.isNew ? 'New task' : t.name} · ittracks</title></svelte:head>

<header class="bar">
	<h1>{data.isNew ? 'New task' : 'Edit task'}</h1>
	<a href="/library">Cancel</a>
</header>

{#if data.archived}
	<form method="POST" action="?/unarchive" class="card row archived" use:enhance>
		<span class="grow">This Task is archived. It keeps its history but is hidden from the Library and pickers.</span>
		<button class="small">Unarchive</button>
	</form>
{/if}

{#if data.usage}
	<p class="muted small-text">
		{#if data.usage.habits.length}
			Used in {#each data.usage.habits as h, i (h.id)}{i ? ', ' : ''}<a href="/habits/{h.id}">{h.name}</a>{/each}.
		{:else}
			Not used in any habit.
		{/if}
		{#if data.usage.lastLogged}Logged {data.usage.timesLogged} {data.usage.timesLogged === 1 ? 'time' : 'times'}, last on {ago(data.usage.lastLogged)}.{/if}
	</p>
{/if}

{#if data.history?.items.length}
	<details class="history" open>
		<summary>History</summary>
		<CardGrid
			items={data.history.items}
			where={{ board: '' }}
			board={{ range: '90d', filter: { areas: [], tags: [], habit: null, identity: null, direction: 'all' } }}
			catalog={data.history.catalog}
			measures={data.history.measures}
			hidden={[]}
			suggested={[]}
			gallery={[]}
			readonly
			csv={(id) => `/stats/export?task=${data.taskId}&card=${id}`}
		/>
	</details>
{/if}

{#if data.isNew}
	<div class="card">
		<span class="muted small-text">Start from a type</span>
		<div class="chips">
			{#each data.types as type (type.key)}
				<button type="button" class="chip" class:on={typeKey === type.key} title={type.description} onclick={() => applyType(type)}>{type.name}</button>
			{/each}
		</div>
		{#if typeKey}<p class="muted small-text" style="margin: 0.4rem 0 0">{data.types.find((x) => x.key === typeKey)?.description}</p>{/if}
	</div>
{/if}

<form method="POST" action="?/save" class="stack">
	<input type="hidden" name="payload" value={JSON.stringify(t)} />

	<label>Name <input bind:value={t.name} placeholder="Bench press" required /></label>
	<label
		>Area
		<select value={t.areaId ?? ''} onchange={(e) => (t.areaId = e.currentTarget.value || null)}>
			<option value="">None</option>
			{#each data.areas as a (a.id)}<option value={a.id}>{a.icon} {a.name}</option>{/each}
		</select>
	</label>
	{#if data.collections.length}
		<div>
			<span class="muted small-text">Collections</span>
			<div class="chips">
				{#each data.collections as c (c.id)}
					<button type="button" class="chip" class:on={t.collectionIds.includes(c.id)} onclick={() => toggleCollection(c.id)}>{c.name}</button>
				{/each}
			</div>
		</div>
	{/if}
	<label>Notes <textarea bind:value={t.notes} rows="2"></textarea></label>

	<h2>Tags</h2>
	<p class="muted">Tags describe what a Task works on. Fill rules use them to pick Tasks for you.</p>
	{#each t.tags as g, i (g.name)}
		<div class="row">
			<span class="grow">{g.name}</span>
			<select bind:value={g.level} aria-label="Level for {g.name}" style="width: auto">
				<option value={1}>low</option>
				<option value={2}>medium</option>
				<option value={3}>high</option>
			</select>
			<button type="button" class="small danger" onclick={() => t.tags.splice(i, 1)}>Remove</button>
		</div>
	{/each}
	<div class="row">
		<label class="grow"
			>New tag <input bind:value={newTag} list="all-tags" placeholder="triceps"
				onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} /></label
		>
		<select bind:value={newLevel} aria-label="Level" style="width: auto">
			<option value={1}>low</option>
			<option value={2}>medium</option>
			<option value={3}>high</option>
		</select>
		<button type="button" onclick={addTag}>Add</button>
	</div>
	<datalist id="all-tags">
		{#each data.allTags as name (name)}<option value={name}></option>{/each}
	</datalist>

	<h2>What you log</h2>
	<p class="muted">
		Metrics are the values you fill in. Mark one "per set" to log it again for every set.
	</p>
	{#each t.metrics as m, i (m.id)}
		<div class="card stack">
			<div class="row">
				<label class="grow">Name <input bind:value={m.name} placeholder="Weight" required /></label>
				<label class="grow"
					>Type
					<select bind:value={m.type}>
						{#each metricTypes as type (type)}<option value={type}>{typeLabels[type]}</option>{/each}
					</select>
				</label>
				{#if m.type === 'number' || m.type === 'count' || m.type === 'duration'}
					<label style="width: 6rem">Unit <input bind:value={m.unit} placeholder="kg" /></label>
				{/if}
			</div>
			{#if m.type === 'choice'}
				<label
					>Options, separated by commas
					<input
						value={m.choices.join(', ')}
						oninput={(e) =>
							(m.choices = e.currentTarget.value
								.split(',')
								.map((s) => s.trim())
								.filter(Boolean))}
						placeholder="wide, narrow"
					/>
				</label>
			{/if}
			<details class="log-settings">
				<summary class="small-text">When logging</summary>
				<div class="row">
					{#if m.type === 'checkbox'}
						<p class="muted small-text grow" style="margin: 0">{prefillBlock({ ...m, prefill: 'last' })?.reason}.</p>
					{:else}
						<label class="grow"
							>Start with
							<select bind:value={m.prefill}>
								<option value="last">Last time's value</option>
								<option value="target" disabled={!isNumeric(m)}>The target{isNumeric(m) ? '' : ' (numbers only)'}</option>
								<option value="blank">Blank</option>
							</select>
						</label>
					{/if}
					{#if isNumeric(m)}
						<label style="width: 7rem"
							>+/− step
							<input type="number" step="any" min="0" value={m.step ?? ''} placeholder={String(defaultStep(m.type, m.unit))}
								oninput={(e) => (m.step = e.currentTarget.value && Number(e.currentTarget.value) > 0 ? Number(e.currentTarget.value) : null)} />
						</label>
					{/if}
				</div>
				<label style="color: var(--text)"
					><input type="checkbox" bind:checked={m.required} onchange={() => m.required && (m.quick = true)} /> Required before Finish</label
				>
				<label style="color: var(--text)"
					><input type="checkbox" bind:checked={m.quick} disabled={m.required} /> Show on quick logs</label
				>
				{#if m.required}<p class="muted small-text" style="margin: 0">{quickBlock({ ...m, quick: false })?.reason}.</p>{/if}
			</details>
			<div class="row">
				<label class="grow" style="color: var(--text)"
					><input type="checkbox" bind:checked={m.repeats} /> Log per set</label
				>
				<button type="button" class="small" onclick={() => move(t.metrics, i, -1)} aria-label="Move up">↑</button>
				<button type="button" class="small" onclick={() => move(t.metrics, i, 1)} aria-label="Move down">↓</button>
				<button type="button" class="small danger" onclick={() => t.metrics.splice(i, 1)}>Remove</button>
			</div>
		</div>
	{/each}
	<div class="row">
		<button type="button" onclick={() => addMetric()}>Add metric</button>
		<button type="button" onclick={() => applyType(data.types[0])}>Use weight and reps per set</button>
	</div>

	<h2>Sub-tasks</h2>
	<p class="muted">Smaller steps ticked off as a checklist, like "warm-up set".</p>
	{#each t.subtasks as s, i (s.id)}
		<div class="row">
			<input class="grow" bind:value={s.name} aria-label="Sub-task name" required />
			<button type="button" class="small danger" onclick={() => t.subtasks.splice(i, 1)}>Remove</button>
		</div>
	{/each}
	<button type="button" onclick={() => t.subtasks.push({ id: crypto.randomUUID(), name: '' })}
		>Add sub-task</button
	>

	<h2>Rest timer</h2>
	<div class="row">
		<label class="grow" style="color: var(--text)"
			><input type="checkbox" bind:checked={t.restTimerEnabled} disabled={!!restBlock && !t.restTimerEnabled} /> Start a rest countdown after each set</label
		>
		{#if restBlock}<p class="muted small-text" style="margin: 0">{restBlock.reason}. Mark a metric "Log per set" first.</p>{/if}
		{#if t.restTimerEnabled}
			<label style="width: 8rem"
				>Seconds <input type="number" min="5" max="3600" bind:value={t.restTimerSeconds} /></label
			>
		{/if}
	</div>

	{#each [...new Set(ruleCheck.errors.map((i) => i.reason))] as reason (reason)}<p class="error">{reason}</p>{/each}
	{#if form?.error}<p class="error">{form.error}</p>{/if}

	<div class="actions">
		<button class="primary">Save task</button>
		{#if !data.isNew}
			<div class="row">
				<button formaction="?/duplicate" formnovalidate>Duplicate</button>
				{#if !data.archived}<button formaction="?/archive" formnovalidate>Archive</button>{/if}
				<button
					class="danger"
					formaction="?/delete"
					formnovalidate
					onclick={(e) => !confirm('Delete this task and every log of it? Archive keeps the history.') && e.preventDefault()}>Delete</button
				>
			</div>
		{/if}
	</div>
</form>

{#if t.metrics.length}
	<details class="card" style="margin-top: 1.5rem">
		<summary>Save these fields as a Task type</summary>
		<form method="POST" action="?/saveType" class="row" style="margin-top: 0.5rem" use:enhance={() => async ({ update }) => update({ reset: false })}>
			<input type="hidden" name="type" value={typePayload} />
			<input class="grow" bind:value={typeName} placeholder="Type name, e.g. Swimming" aria-label="Type name" />
			<button disabled={!typeName.trim()}>Save type</button>
		</form>
		{#if form?.typeSaved}<p class="muted small-text">Saved "{form.typeSaved}". It's offered when you make a new Task.</p>{/if}
	</details>
{/if}

<style>
	.log-settings summary {
		cursor: pointer;
		color: var(--accent);
	}
	.log-settings[open] > * + * {
		margin-top: 0.5rem;
	}
	.small-text {
		font-size: 0.85rem;
	}
	.archived {
		margin-bottom: 1rem;
		align-items: center;
	}
	.history {
		margin-bottom: 1.25rem;
	}
	.history summary {
		cursor: pointer;
		font-weight: 600;
		margin-bottom: 0.6rem;
	}
</style>
