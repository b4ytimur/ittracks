<script lang="ts">
	// Your measures, each a line inside the line. A formula that doesn't read is not saved, and says why.
	import { invalidateAll } from '$app/navigation';
	import SaidLine from '$lib/detail/SaidLine.svelte';
	import { statsOp } from '$lib/stats/client';
	import { FUNCTIONS, formulaProblem } from '$lib/stats/formula';
	import { newId, type CustomMeasure } from '$lib/stats/model';
	import { showToast } from '$lib/toast.svelte';

	let { measures, fields }: { measures: CustomMeasure[]; fields: { name: string; tasks: string[] }[] } = $props();

	const known = $derived([...fields.map((f) => f.name), 'Weight', 'Reps']);
	let open = $state<Record<string, boolean>>({});
	let problem = $state<Record<string, string>>({});
	/** One being made, kept here until it has a name and a formula that reads. */
	let fresh = $state<CustomMeasure | null>(null);
	const shown = $derived(fresh && !measures.some((m) => m.id === fresh!.id) ? [...measures, fresh] : measures);
	const combines = { sum: 'added up', max: 'the best one', avg: 'the average' } as const;
	const words = (m: CustomMeasure) => `${m.formula || 'No formula yet'}${m.unit ? `, in ${m.unit}` : ''}. ${m.per === 'set' ? `On each set, ${combines[m.combine]}.` : 'Once per log.'}`;

	async function put(m: CustomMeasure) {
		try {
			await statsOp({ op: 'measure.save', measure: m });
		} catch (e) {
			problem[m.id] = navigator.onLine ? (e as Error).message : 'Not saved. Are you online?';
			return false;
		}
		await invalidateAll();
		return true;
	}
	async function change(m: CustomMeasure, values: Partial<CustomMeasure>) {
		const next = { ...$state.snapshot(m), ...values } as CustomMeasure;
		const isNew = fresh?.id === m.id;
		if (isNew) fresh = next;
		problem[m.id] = !next.name ? 'Not saved yet. Give it a name.' : !next.formula ? 'Not saved yet. Give it a formula.' : (formulaProblem(next.formula, known) ?? '');
		if (problem[m.id]) return;
		const before = $state.snapshot(m) as CustomMeasure;
		if (!(await put(next))) return;
		if (isNew) fresh = null;
		showToast(isNew ? `Added ${next.name}. A Stats card can count by it now.` : `Changed ${next.name}.`, isNew ? () => del(next.id) : () => put(before));
	}
	async function del(id: string) {
		try {
			await statsOp({ op: 'measure.delete', id });
		} catch {
			return false;
		}
		await invalidateAll();
		return true;
	}
	async function remove(m: CustomMeasure) {
		if (fresh?.id === m.id) return void (fresh = null);
		const before = $state.snapshot(m) as CustomMeasure;
		if (await del(m.id)) showToast(`Deleted ${before.name}. Cards that used it say so until you pick another.`, () => put(before));
		else problem[m.id] = 'Not deleted. Are you online?';
	}
	function add() {
		fresh ??= { id: newId(), name: '', formula: '', per: 'set', combine: 'sum', unit: '' };
		open[fresh.id] = true;
	}
</script>

{#if shown.length}
	<div class="se-sub">
		{#each shown as m (m.id)}
			<SaidLine id="m-{m.id}" label={m.name || 'New measure'} words={words(m)} bind:open={() => !!open[m.id], (v) => (open[m.id] = v)} problem={problem[m.id] || (formulaProblem(m.formula || '0', known) ?? '')} onremove={() => remove(m)} removeLabel={fresh?.id === m.id ? 'Leave it' : `Delete ${m.name}`}>
				<div class="se-dates">
					<div class="field"><label class="label" for="mn-{m.id}">Name</label><input id="mn-{m.id}" value={m.name} maxlength="40" placeholder="Tonnage" onchange={(e) => change(m, { name: e.currentTarget.value.trim() })} /></div>
					<div class="field"><label class="label" for="mu-{m.id}">Unit</label><input id="mu-{m.id}" value={m.unit} maxlength="16" placeholder="kg" onchange={(e) => change(m, { unit: e.currentTarget.value.trim() })} /></div>
				</div>
				<div class="field"><label class="label" for="mf-{m.id}">Formula</label><input id="mf-{m.id}" value={m.formula} maxlength="300" placeholder="[Weight] * [Reps]" spellcheck="false" autocomplete="off" onchange={(e) => change(m, { formula: e.currentTarget.value.trim() })} /></div>
				<div class="se-dates">
					<div class="field">
						<label class="label" for="mp-{m.id}">Worked out</label>
						<select id="mp-{m.id}" value={m.per} onchange={(e) => change(m, { per: e.currentTarget.value as CustomMeasure['per'] })}><option value="set">On each set</option><option value="log">Once per log</option></select>
					</div>
					{#if m.per === 'set'}
						<div class="field">
							<label class="label" for="mc-{m.id}">Then</label>
							<select id="mc-{m.id}" value={m.combine} onchange={(e) => change(m, { combine: e.currentTarget.value as CustomMeasure['combine'] })}><option value="sum">Add the sets up</option><option value="max">Take the best set</option><option value="avg">Average the sets</option></select>
						</div>
					{/if}
				</div>
				<details>
					<summary class="meta">Fields and functions you can use</summary>
					<p class="meta">
						Fields, in square brackets: {#each fields as f, i (f.name)}{i ? ', ' : ''}<code>[{f.name}]</code>{/each}{fields.length ? ', ' : ''}<code>[Weight]</code> and <code>[Reps]</code> (the weight and reps of a set, whatever they're called).
					</p>
					<p class="meta">
						Numbers, <code>+ - * / ^</code>, parentheses, and {#each Object.entries(FUNCTIONS) as [k, v], i (k)}{i ? ', ' : ''}<code>{k}()</code> ({v.toLowerCase()}){/each}. A missing value or a division by zero gives no number for that log, never a made-up 0.
					</p>
				</details>
			</SaidLine>
		{/each}
	</div>
{/if}
{#if !fresh}<div><button type="button" class="hit" onclick={add}>+ Measure</button></div>{/if}
