<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/toast.svelte';
	import { statsOp } from '$lib/stats/client';
	import { FUNCTIONS, formulaProblem } from '$lib/stats/formula';
	import { E1RM_PRESETS, newId, type CustomMeasure } from '$lib/stats/model';

	let { data } = $props();

	const known = $derived([...data.fields.map((f) => f.name), 'Weight', 'Reps']);
	const blankMeasure = (): CustomMeasure => ({ id: newId(), name: '', formula: '', per: 'set', combine: 'sum', unit: '' });
	let draft = $state<CustomMeasure | null>(null);
	const draftProblem = $derived(draft && draft.formula.trim() ? formulaProblem(draft.formula, known) : null);

	let e1rm = $state(untrack(() => data.e1rm));
	let maxReps = $state(untrack(() => data.e1rmMaxReps));
	let muscle = $state(untrack(() => ({ ...data.muscle })));
	const preset = $derived(Object.entries(E1RM_PRESETS).find(([, p]) => p.formula === e1rm)?.[0] ?? 'custom');
	const e1rmProblem = $derived(
		formulaProblem(e1rm) ?? (!/\[\s*weight\s*\]/i.test(e1rm) || !/\[\s*reps\s*\]/i.test(e1rm) ? 'The formula needs [Weight] and [Reps]' : null)
	);

	async function op(body: Record<string, unknown>, done?: string) {
		try {
			const r = await statsOp(body);
			await invalidateAll();
			if (done) showToast(done);
			return r;
		} catch (e) {
			showToast((e as Error).message);
			return null;
		}
	}
	async function saveMeasure() {
		if (!draft || !draft.name.trim() || !draft.formula.trim() || draftProblem) return;
		const m = { ...$state.snapshot(draft), name: draft.name.trim(), formula: draft.formula.trim(), unit: draft.unit.trim() };
		if (await op({ op: 'measure.save', measure: m }, `Saved “${m.name}”. Pick it under “Each log counts as” on a Task card.`)) draft = null;
	}
	async function deleteMeasure(m: CustomMeasure) {
		if (await op({ op: 'measure.delete', id: m.id }))
			showToast(`Deleted “${m.name}”. Cards that used it show a note until you pick another measure.`, async () => {
				await statsOp({ op: 'measure.save', measure: m });
				await invalidateAll();
			});
	}
	const saveE1rm = () => !e1rmProblem && op({ op: 'settings', e1rm, e1rmMaxReps: maxReps }, 'Saved. e1RM cards use the new formula.');
	const saveMuscle = () => op({ op: 'settings', muscle: $state.snapshot(muscle) }, 'Saved.');
	const muscleWarn = $derived(muscle.high < muscle.medium || muscle.medium < muscle.low);
</script>

<svelte:head><title>Your measures and formulas · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Your measures and formulas</h1>
	<a href="/settings">‹ Settings</a>
</header>

<section class="card stack">
	<h2 class="flush">Your measures</h2>
	<p class="muted small-text flush">
		A measure is a formula over the fields you log, like <code>[Weight] * [Reps]</code> or <code>[Distance] / [Time] * 60</code>. Once saved, pick it under "Each log counts as" on any Task card.
	</p>
	{#if data.measures.length}
		<ul class="list">
			{#each data.measures as m (m.id)}
				<li class="measure">
					<div class="grow">
						<strong>{m.name}</strong>{m.unit ? ` (${m.unit})` : ''}
						<div class="muted small-text"><code>{m.formula}</code> · {m.per === 'set' ? `each set, ${m.combine === 'sum' ? 'added up' : m.combine === 'max' ? 'best set' : 'averaged'}` : 'once per log'}</div>
						{#if formulaProblem(m.formula, known)}<div class="error small-text">{formulaProblem(m.formula, known)}</div>{/if}
					</div>
					<button type="button" class="small" onclick={() => (draft = { ...m })}>Edit</button>
					<button type="button" class="small danger" onclick={() => deleteMeasure(m)}>Delete</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if draft}
		<form class="stack draft" onsubmit={(e) => (e.preventDefault(), saveMeasure())}>
			<div class="row">
				<label class="grow">Name <input bind:value={draft.name} maxlength="40" placeholder="Tonnage" required /></label>
				<label style="width: 7rem">Unit <input bind:value={draft.unit} maxlength="16" placeholder="kg" /></label>
			</div>
			<label>
				Formula
				<input bind:value={draft.formula} maxlength="300" placeholder="[Weight] * [Reps]" spellcheck="false" autocomplete="off" required />
			</label>
			{#if draftProblem}<p class="error small-text flush">{draftProblem}</p>{:else if draft.formula.trim()}<p class="muted small-text flush">Reads fine.</p>{/if}
			<div class="row">
				<label class="grow">
					Work it out
					<select bind:value={draft.per}>
						<option value="set">On each set</option>
						<option value="log">Once per log</option>
					</select>
				</label>
				{#if draft.per === 'set'}
					<label class="grow">
						Then
						<select bind:value={draft.combine}>
							<option value="sum">Add the sets up</option>
							<option value="max">Take the best set</option>
							<option value="avg">Average the sets</option>
						</select>
					</label>
				{/if}
			</div>
			<details>
				<summary class="small-text">Fields and functions you can use</summary>
				<p class="small-text">
					Fields, in square brackets: {#each data.fields as f, i (f.name)}{i ? ', ' : ''}<code>[{f.name}]</code>{/each}{data.fields.length ? ', ' : ''}<code>[Weight]</code> and <code>[Reps]</code> (the weight and reps of a set, whatever they're called).
				</p>
				<p class="small-text">
					Numbers, <code>+ - * / ^</code>, parentheses, and {#each Object.entries(FUNCTIONS) as [k, v], i (k)}{i ? ', ' : ''}<code>{k}()</code> <span class="muted">({v.toLowerCase()})</span>{/each}. A missing value or a division by zero gives no number for that log, never a made-up 0.
				</p>
			</details>
			<div class="row">
				<button type="button" onclick={() => (draft = null)}>Cancel</button>
				<button class="primary" disabled={!draft.name.trim() || !draft.formula.trim() || !!draftProblem}>Save measure</button>
			</div>
		</form>
	{:else}
		<div><button type="button" onclick={() => (draft = blankMeasure())}>Add a measure</button></div>
	{/if}
</section>

<section class="card stack">
	<h2 class="flush">Estimated 1RM</h2>
	<p class="muted small-text flush">How the best single lift is estimated from a set's weight and reps.</p>
	<div class="chips">
		{#each Object.entries(E1RM_PRESETS) as [k, p] (k)}
			<button type="button" class="chip" class:on={preset === k} aria-pressed={preset === k} onclick={() => (e1rm = p.formula)}>{p.name}</button>
		{/each}
		<span class="chip" class:on={preset === 'custom'}>Your own</span>
	</div>
	<label>Formula <input bind:value={e1rm} maxlength="300" spellcheck="false" autocomplete="off" /></label>
	{#if e1rmProblem}<p class="error small-text flush">{e1rmProblem}</p>{/if}
	<label style="max-width: 16rem">Only for sets of this many reps or fewer <input type="number" min="1" max="30" bind:value={maxReps} /></label>
	<div><button type="button" class="primary" disabled={!!e1rmProblem} onclick={saveE1rm}>Save</button></div>
</section>

<section class="card stack">
	<h2 class="flush">Muscle groups</h2>
	<p class="muted small-text flush">
		When hard sets or volume are split by tag, a set counts toward each of its Task's tags by the tag's level. 1 is a full set, 0.5 half, 0 not at all.
	</p>
	<div class="row">
		<label class="grow">High <input type="number" min="0" max="1" step="0.05" bind:value={muscle.high} /></label>
		<label class="grow">Medium <input type="number" min="0" max="1" step="0.05" bind:value={muscle.medium} /></label>
		<label class="grow">Low <input type="number" min="0" max="1" step="0.05" bind:value={muscle.low} /></label>
	</div>
	{#if muscleWarn}<p class="muted small-text flush">A high tag usually counts at least as much as a medium one, and medium as much as low.</p>{/if}
	<div><button type="button" class="primary" onclick={saveMuscle}>Save</button></div>
</section>

<style>
	section + section {
		margin-top: 1rem;
	}
	.flush {
		margin: 0;
	}
	.measure {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--grid);
	}
	.grow {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.draft {
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}
	.small-text {
		font-size: 0.85rem;
	}
	code {
		font-size: 0.85em;
		background: var(--grid);
		padding: 0 0.25rem;
		border-radius: 4px;
	}
	.chip {
		background: var(--surface);
		cursor: pointer;
		font-size: 0.85rem;
		padding: 0.25rem 0.65rem;
	}
</style>
