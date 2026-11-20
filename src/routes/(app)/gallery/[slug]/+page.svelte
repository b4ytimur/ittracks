<script lang="ts">
	import { untrack } from 'svelte';
	import { applyAnswers, fromTemplate, type TemplateAnswers } from '$lib/template';
	import { describeSchedule, weekdayNames } from '$lib/describe';
	import { dueOn, type Done, type Schedule } from '$lib/engine/schedule';
	import { addDays, weekStart } from '$lib/engine/dates';

	let { data, form } = $props();
	const tpl = untrack(() => data.template);

	let name = $state(tpl.habit.name);
	let separate = $state(false);
	let answers = $state<TemplateAnswers>(Object.fromEntries(tpl.questions.map((q) => [q.key, structuredClone(q.default)])));

	const toggleDay = (key: string, d: number) => {
		const cur = (answers[key] as number[]) ?? [];
		answers[key] = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
	};

	// The same steps the server runs, so the preview matches what gets added.
	const preview = $derived.by(() => {
		let n = 0;
		const filled = applyAnswers(tpl, $state.snapshot(answers));
		const made = fromTemplate(filled, data.today, () => `id${n++}`);
		const variantName = new Map(made.habit.variants.map((v) => [v.id, v.name]));
		const s = made.habit.schedule as Schedule | null;
		const weeks: { date: string; variant: string | null }[][] = [];
		if (s && s.kind !== 'frequency') {
			const history: Done[] = [];
			const start = weekStart(data.today);
			for (let w = 0; w < 4; w++) {
				const week = [];
				for (let d = 0; d < 7; d++) {
					const date = addDays(start, w * 7 + d);
					const v = date < data.today ? null : dueOn(s, history, date);
					if (v) history.push({ date, variantId: v, status: 'done' });
					week.push({ date, variant: v ? (variantName.get(v) ?? '') : null });
				}
				weeks.push(week);
			}
		}
		return { filled, made, weeks, schedule: describeSchedule(made.habit.schedule) };
	});

	const taskByKey = $derived(new Map(preview.filled.tasks.map((t) => [t.key, t])));
	const shortName = (v: string) => (v.length > 8 ? v.slice(0, 7) + '…' : v);
	const day = (d: string) => Number(d.slice(8));
</script>

<svelte:head><title>{tpl.name} · Gallery · ittracks</title></svelte:head>

<header class="bar">
	<h1>{tpl.name}</h1>
	<a href="/gallery">Gallery</a>
</header>

<p>{tpl.description}</p>

<form method="POST" action="?/add" class="stack">
	<label>Habit name <input name="name" bind:value={name} required /></label>

	{#each tpl.questions as q (q.key)}
		{#if q.kind === 'days'}
			<fieldset>
				<legend>{q.label}</legend>
				<div class="chips">
					{#each weekdayNames as w, d (w)}
						{@const on = ((answers[q.key] as number[]) ?? []).includes(d)}
						<button type="button" class="chip" class:on aria-pressed={on} onclick={() => toggleDay(q.key, d)}>{w}</button>
						{#if on}<input type="hidden" name="q_{q.key}" value={d} />{/if}
					{/each}
				</div>
			</fieldset>
		{:else if q.kind === 'number'}
			<label
				>{q.label}{q.unit ? ` (${q.unit})` : ''}
				<input type="number" step="any" name="q_{q.key}" bind:value={answers[q.key]} style="width: 8rem" /></label
			>
		{:else}
			<label>{q.label} <input type="time" name="q_{q.key}" bind:value={answers[q.key]} style="width: auto" /></label>
		{/if}
	{/each}

	{#if preview.made.habit.direction === 'build'}
		<section class="card">
			<strong>{preview.schedule}</strong>
			{#if preview.weeks.length}
				<div class="cal" aria-label="The next four weeks">
					{#each weekdayNames as w (w)}<span class="muted head">{w}</span>{/each}
					{#each preview.weeks.flat() as c (c.date)}
						<span class="cell" class:due={c.variant !== null} class:past={c.date < data.today} title={c.variant ?? ''}>
							<span class="num">{day(c.date)}</span>
							{#if c.variant !== null && preview.made.habit.variants.length > 1}<span class="v">{shortName(c.variant)}</span>{/if}
						</span>
					{/each}
				</div>
			{/if}
			{#if preview.filled.habit.cue?.time || preview.filled.habit.cue?.range}
				<p class="muted small-text">Reminder: {preview.filled.habit.cue.time ?? preview.filled.habit.cue.range}</p>
			{/if}
		</section>

		{#each preview.filled.habit.variants as v (v.key)}
			<section class="card">
				{#if preview.filled.habit.variants.length > 1}<strong>{v.name}</strong>{/if}
				<ul class="slots">
					{#each v.slots as s, i (i)}
						{@const t = s.task ? taskByKey.get(s.task) : undefined}
						{#if t}
							<li>
								<span>{t.name}</span>
								{#if data.inLibrary.includes(t.key) && !separate}<span class="chip">in your Library</span>{/if}
								<span class="muted small-text">
									{s.sets ? `${s.sets} × ` : ''}{t.metrics
										.map((m) => (s.targets[m.key] !== undefined ? `${s.targets[m.key]}${m.unit ? ' ' + m.unit : ''} ${m.name.toLowerCase()}` : m.name.toLowerCase()))
										.join(', ')}
								</span>
							</li>
						{/if}
					{/each}
				</ul>
			</section>
		{/each}
	{:else}
		<section class="card">
			<strong>Something to break</strong>
			<p class="muted small-text">Log slips and resisted cravings from Today. No schedule to keep.</p>
			{#if tpl.habit.ifThen}<p class="small-text">If {tpl.habit.ifThen.when}, then {tpl.habit.ifThen.then}.</p>{/if}
		</section>
	{/if}

	{#if data.inLibrary.length}
		<label style="color: var(--text)"
			><input type="checkbox" name="separate" bind:checked={separate} /> Make separate Tasks instead of using the {data.inLibrary.length === 1 ? 'one' : data.inLibrary.length} already in your Library</label
		>
	{/if}

	{#if form?.error}<p class="error">{form.error}</p>{/if}
	<button class="primary">Add this habit</button>
	<p class="muted small-text">You can change the schedule, Tasks and targets afterwards in the habit editor.</p>
</form>

<style>
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}
	legend {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.cal {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 0.25rem;
		margin-top: 0.6rem;
		text-align: center;
	}
	.head {
		font-size: 0.75rem;
	}
	.cell {
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.2rem 0;
		min-height: 2.4rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		font-size: 0.8rem;
	}
	.cell.past {
		opacity: 0.4;
	}
	.cell.due {
		border-color: var(--accent);
		color: var(--accent);
		font-weight: 600;
	}
	.v {
		font-size: 0.65rem;
		font-weight: 400;
		overflow: hidden;
		max-width: 100%;
	}
	.slots {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0 0;
		display: grid;
		gap: 0.35rem;
	}
	.slots li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: baseline;
	}
	.small-text {
		font-size: 0.85rem;
	}
</style>
