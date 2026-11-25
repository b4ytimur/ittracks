<script lang="ts">
	// What a new Task can start from: its name and the words for its rows are changed here, its fields
	// by saving a Task's fields as a type again.
	import { untrack } from 'svelte';
	import SaidLine from '$lib/detail/SaidLine.svelte';
	import { rowWords } from '$lib/forms';
	import type { TaskType } from '$lib/task-types';
	import { withShownUnits } from '$lib/units';
	import { units } from '$lib/units-here';

	let { types, plain, problem = $bindable(''), onsave }: { types: TaskType[]; plain: TaskType[]; problem?: string; onsave: (types: TaskType[], said: string) => void } = $props();

	let open = $state<Record<string, boolean>>({});
	let rows = $state(untrack(() => $state.snapshot(types)));
	$effect(() => {
		rows = $state.snapshot(types);
	});
	const fields = (t: TaskType) => t.metrics.map((m) => `${m.name}${m.unit ? ` in ${withShownUnits(m.unit, units()) || 'no unit'}` : ''}`).join(', ') || 'nothing to fill in';
	const inRows = (t: TaskType) => t.metrics.some((m) => m.repeats);
	const words = (t: TaskType) => ({ ...rowWords(), ...t.words });
	const said = (t: TaskType) => `${fields(t).charAt(0).toUpperCase()}${fields(t).slice(1)}.${inRows(t) ? ` One row is a ${words(t).rowOne}.` : ''}`;
	function change(t: TaskType, v: Partial<TaskType>) {
		if (v.name === '') return void (problem = `Not saved. ${t.name} needs a name.`);
		if (v.words && Object.values(v.words).some((w) => !w.trim())) return void (problem = 'Not saved. Each word needs at least a letter.');
		problem = '';
		onsave(types.map((x) => (x.key === t.key ? { ...$state.snapshot(x), ...v } : $state.snapshot(x))) as TaskType[], `Changed the type ${v.name ?? t.name}.`);
	}
</script>

{#if rows.length}
	<div class="se-sub">
		{#each rows as t (t.key)}
			<SaidLine id="type-{t.key}" label={t.name} words={said(t)} bind:open={() => !!open[t.key], (v) => (open[t.key] = v)} onremove={() => onsave($state.snapshot(types).filter((x) => x.key !== t.key) as TaskType[], `Deleted the type ${t.name}. Tasks made from it stay.`)} removeLabel="Delete {t.name}">
				<div class="field"><label class="label" for="tn-{t.key}">Name</label><input id="tn-{t.key}" value={t.name} maxlength="40" onchange={(e) => change(t, { name: e.currentTarget.value.trim() })} /></div>
				{#if inRows(t)}
					<div class="se-dates three">
						{#each [['rowOne', 'One row'], ['rowMany', 'Several'], ['betweenName', 'The clock']] as const as [k, label] (k)}
							<div class="field"><label class="label" for="{k}-{t.key}">{label}</label><input id="{k}-{t.key}" value={words(t)[k]} maxlength="20" onchange={(e) => change(t, { words: { ...words(t), [k]: e.currentTarget.value.trim() } })} /></div>
						{/each}
					</div>
				{/if}
			</SaidLine>
		{/each}
	</div>
{/if}
<p class="meta">Always there: {plain.map((t) => t.name).join(', ')}. To add a type, or change its fields, open a Task and save its fields as a type.</p>

<style>
	p {
		margin: 0;
	}
	.three {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
</style>
