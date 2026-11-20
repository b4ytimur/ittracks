<script lang="ts">
	import { metricTypes } from '$lib/metric-types';
	import { untrack } from 'svelte';
	import type { TaskForm } from '$lib/forms';

	let { data, form } = $props();

	// The editor works on a local copy; the whole thing is sent as JSON on save.
	let t = $state<TaskForm>(untrack(() => structuredClone(data.task)));
	let newTag = $state('');
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

	function addMetric(preset?: Partial<TaskForm['metrics'][number]>) {
		t.metrics.push({
			id: crypto.randomUUID(),
			name: '',
			type: 'number',
			unit: '',
			repeats: false,
			choices: [],
			...preset
		});
	}

	// Quick start for gym exercises: weight and reps, logged once per set.
	function addSetMetrics() {
		addMetric({ name: 'Weight', type: 'number', unit: data.weightUnit, repeats: true });
		addMetric({ name: 'Reps', type: 'count', repeats: true });
	}

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

<form method="POST" action="?/save" class="stack">
	<input type="hidden" name="payload" value={JSON.stringify(t)} />

	<label>Name <input bind:value={t.name} placeholder="Bench press" required /></label>
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
		<button type="button" onclick={addSetMetrics}>Add weight and reps per set</button>
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
			><input type="checkbox" bind:checked={t.restTimerEnabled} /> Start a rest countdown after each set</label
		>
		{#if t.restTimerEnabled}
			<label style="width: 8rem"
				>Seconds <input type="number" min="5" max="3600" bind:value={t.restTimerSeconds} /></label
			>
		{/if}
	</div>

	{#if form?.error}<p class="error">{form.error}</p>{/if}

	<div class="actions">
		<button class="primary">Save task</button>
		{#if !data.isNew}
			<button
				class="danger"
				formaction="?/delete"
				formnovalidate
				onclick={(e) => !confirm('Delete this task?') && e.preventDefault()}>Delete</button
			>
		{/if}
	</div>
</form>
