<script lang="ts">
	// A template as a sentence: its name, its days, and its questions as slots with their defaults, so
	// adding it takes one press. Under it, in lines: what it adds, what it brings and what is yours
	// already. Inside the page's own form; the fields are named for the server's add action.
	import { describeSchedule, weekdayNames } from '$lib/describe';
	import { applyAnswers, fromTemplate, type TemplateAnswers, type TemplateFile } from '$lib/template';

	let {
		tpl,
		today,
		libraryNames,
		habitNames = [],
		areaNames = [],
		brings = ''
	}: {
		tpl: TemplateFile;
		today: string;
		/** Task names in your Library, lower case, to say which Tasks are reused. */
		libraryNames: string[];
		/** Your habit names, lower case, to say when one has the same name. */
		habitNames?: string[];
		/** Your Area names, lower case. */
		areaNames?: string[];
		/** The pack that comes with it. */
		brings?: string;
	} = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(tpl.habit.name);
	let separate = $state(false);
	// svelte-ignore state_referenced_locally
	let answers = $state<TemplateAnswers>(Object.fromEntries(tpl.questions.map((q) => [q.key, structuredClone(q.default)])));
	// svelte-ignore state_referenced_locally
	let remind = $state(tpl.habit.remind);
	let addAreas = $state(true);

	const toggleDay = (key: string, d: number) => {
		const cur = (answers[key] as number[]) ?? [];
		answers[key] = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
	};
	// The same steps the server runs, so what is said is what gets added.
	const made = $derived.by(() => {
		let n = 0;
		const filled = applyAnswers(tpl, $state.snapshot(answers));
		const m = fromTemplate(filled, today, () => `id${n++}`);
		const byKey = new Map<string | null, { habit: typeof m.habit; depth: number }>([[null, { habit: m.habit, depth: 0 }]]);
		const inside = m.children.map((c) => {
			const parent = byKey.get(c.parent);
			byKey.set(c.key, { habit: c.habit, depth: (parent?.depth ?? 0) + 1 });
			return { key: c.key, name: c.habit.name, depth: (parent?.depth ?? 0) + 1, days: describeSchedule(c.habit.schedule, parent && { name: parent.habit.name, variants: parent.habit.variants }, c.habit.variants) };
		});
		return { filled, habit: m.habit, inside, days: describeSchedule(m.habit.schedule, undefined, m.habit.variants) };
	});
	const stop = $derived(made.habit.direction === 'break');
	const cue = $derived(made.filled.habit.cue?.time ?? made.filled.habit.cue?.range ?? '');
	const mine = (n: string) => libraryNames.includes(n.trim().toLowerCase());
	const reused = $derived(tpl.tasks.filter((t) => mine(t.name)));
	const sameName = $derived(habitNames.includes(name.trim().toLowerCase()));
	const areas = $derived([...new Set([tpl.meta?.area, ...tpl.tasks.map((t) => t.area)].filter((a): a is string => !!a))]);
	const newAreas = $derived(areas.filter((a) => !areaNames.includes(a.toLowerCase())));
	const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
	/** What each Variant has in it: "Push: Bench press, Dips". */
	const variants = $derived(
		made.filled.habit.variants
			.filter((v) => v.slots.length)
			.map((v) => ({ name: v.name, tasks: v.slots.map((s) => (s.task ? (tpl.tasks.find((t) => t.key === s.task)?.name ?? '') : 'one picked for you')).filter(Boolean) }))
	);
	const fields = (t: TemplateFile['tasks'][number]) => t.metrics.map((m) => `${lower(m.name)}${m.unit ? ` in ${m.unit}` : ''}`).join(', ') || 'a tick';
</script>

<div class="card ob-sent">
	<p class="ob-said"><strong>{name.trim() || tpl.name}</strong>{stop ? ' · to stop. A slip is logged when it happens.' : ` · ${lower(made.days)}${cue ? ` · ${/^\d/.test(cue) ? `at ${cue}` : `in the ${cue.toLowerCase()}`}` : ''}`}</p>
	{#each tpl.questions as q (q.key)}
		{#if q.kind === 'days'}
			<div class="field" role="group" aria-label={q.label}>
				<span class="label">{q.label}</span>
				<div class="chips">
					{#each weekdayNames as w, d (w)}
						{@const on = ((answers[q.key] as number[]) ?? []).includes(d)}
						<button type="button" class="toggle" aria-pressed={on} onclick={() => toggleDay(q.key, d)}>{w}</button>
						{#if on}<input type="hidden" name="q_{q.key}" value={d} />{/if}
					{/each}
				</div>
			</div>
		{:else if q.kind === 'number'}
			<div class="field"><label class="label" for="q-{q.key}">{q.label}{q.unit ? ` (${q.unit})` : ''}</label><input id="q-{q.key}" type="number" step="any" class="short" name="q_{q.key}" bind:value={answers[q.key]} /></div>
		{:else}
			<div class="field"><label class="label" for="q-{q.key}">{q.label}</label><input id="q-{q.key}" type="time" class="short" name="q_{q.key}" bind:value={answers[q.key]} /></div>
		{/if}
	{/each}
	<div class="field">
		<label class="label" for="tpl-name">Called</label>
		<input id="tpl-name" name="name" bind:value={name} required maxlength="120" />
		{#if sameName}<p class="meta">You already have a habit called “{name.trim()}”. This adds a second one.</p>{/if}
	</div>
</div>

<section class="ob-sec" aria-label="What it adds">
	<h2 class="section-title">What it adds</h2>
	<ul class="adds">
		{#each made.inside as c (c.key)}<li style:margin-inline-start="{(c.depth - 1) * 1}rem">{c.name} <span class="meta muted">· {lower(c.days)}</span></li>{/each}
		{#each variants as v, i (i)}<li>{variants.length > 1 ? v.name : 'Each time'} <span class="meta muted">· {v.tasks.join(', ')}</span></li>{/each}
		{#each tpl.tasks as t (t.key)}<li>{t.name} <span class="meta muted">· {mine(t.name) && !separate ? 'your Task, used as it is' : `logs ${fields(t)}`}</span></li>{/each}
		{#if brings}<li>{brings}</li>{/if}
		{#if tpl.habit.ifThen && stop}<li>A plan <span class="meta muted">· if {tpl.habit.ifThen.when}, then {tpl.habit.ifThen.then}</span></li>{/if}
		{#if areas.length && !newAreas.length}<li class="meta muted">It goes in your {areas.length === 1 ? 'Area' : 'Areas'} {areas.join(', ')}.</li>{/if}
	</ul>
	{#if reused.length}
		<label class="check"><input type="checkbox" class="pick" name="separate" bind:checked={separate} /> Make separate Tasks instead of using {reused.length === 1 ? `your ${reused[0].name}` : `your ${reused.length}`}</label>
	{/if}
	{#if newAreas.length}
		<label class="check"><input type="checkbox" class="pick" name="addAreas" bind:checked={addAreas} /> Add the {newAreas.length === 1 ? 'Area' : 'Areas'} {newAreas.join(', ')}</label>
	{:else}<input type="hidden" name="addAreas" value="on" />{/if}
	{#if tpl.habit.remind && !stop && cue}
		<label class="check"><input type="checkbox" class="pick" name="remind" bind:checked={remind} /> Remind me</label>
	{/if}
</section>

<style>
	p {
		margin: 0;
	}
	.short {
		width: 9rem;
	}
	.adds {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-tight);
		overflow-wrap: anywhere;
	}
</style>
