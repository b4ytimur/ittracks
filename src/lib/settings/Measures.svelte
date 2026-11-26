<script lang="ts">
	// Your measures, each a line inside the line. A formula that doesn't read is not saved, and says
	// why; one that names a field nobody has is, and says that it counts nothing until one does.
	import { invalidateAll } from '$app/navigation';
	import SaidLine from '$lib/detail/SaidLine.svelte';
	import { statsOp } from '$lib/stats/client';
	import { compile, fieldsOf, FormulaError, FUNCTIONS, formulaProblem } from '$lib/stats/formula';
	import { newId, OVER_TIME, type CustomMeasure, type OverTime } from '$lib/stats/model';
	import { withShownUnits } from '$lib/units';
	import { units } from '$lib/units-here';
	import { showToast } from '$lib/toast.svelte';

	let {
		measures,
		fields,
		suggestions
	}: {
		measures: CustomMeasure[];
		fields: { name: string; tasks: string[] }[];
		/** Other formulas for the same thing, by measure. */
		suggestions: Record<string, { name: string; formula: string }[]>;
	} = $props();

	const known = $derived(new Set(fields.map((f) => f.name.toLowerCase())));
	let open = $state<Record<string, boolean>>({});
	let problem = $state<Record<string, string>>({});
	/** One being made, kept here until it has a name and a formula that reads. */
	let fresh = $state<CustomMeasure | null>(null);
	const listed = $derived(measures.filter((m) => !m.off));
	const shown = $derived(fresh && !listed.some((m) => m.id === fresh!.id) ? [...listed, fresh] : listed);
	const combines = { sum: 'added up', max: 'the best one', avg: 'the average' } as const;
	const unitSaid = (u: string) => withShownUnits(u, units()).replace(/\[([^\]|]+)[^\]]*\]/g, '$1’s unit');
	const words = (m: CustomMeasure) => `${m.formula || 'No formula yet'}${m.unit ? `, in ${unitSaid(m.unit)}` : ''}. ${m.per === 'set' ? `On each set, ${combines[m.combine]}.` : 'Once per log.'}`;
	function missing(m: CustomMeasure): string {
		const f = compile(m.formula);
		if (f instanceof FormulaError) return '';
		const gone = fieldsOf(f).filter((n) => !known.has(n.trim().toLowerCase()));
		// One of the fields in first() is enough, and the plain name leads them.
		if (!gone.length || (/first\(/.test(m.formula) && gone.length < fieldsOf(f).length)) return '';
		return `No Task has a field called ${gone.join(' or ')}. It counts nothing until one does.`;
	}

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
		problem[m.id] = !next.name ? 'Not saved yet. Give it a name.' : !next.formula ? 'Not saved yet. Give it a formula.' : (formulaProblem(next.formula) ?? '');
		if (problem[m.id]) return;
		const before = $state.snapshot(m) as CustomMeasure;
		if (!(await put(next))) return;
		if (isNew) fresh = null;
		showToast(isNew ? `Added ${next.name}. A Stats card can count by it now.` : `Changed ${next.name}.`, isNew ? async () => (await del(next.id)) !== null : () => put(before));
	}
	/** How many cards keep it, or null when it wasn't deleted. */
	async function del(id: string): Promise<number | null> {
		try {
			const r = await statsOp<{ used: number }>({ op: 'measure.delete', id });
			await invalidateAll();
			return r.used;
		} catch {
			return null;
		}
	}
	async function remove(m: CustomMeasure) {
		if (fresh?.id === m.id) return void (fresh = null);
		const before = $state.snapshot(m) as CustomMeasure;
		const kept = await del(m.id);
		if (kept === null) return void (problem[m.id] = 'Not deleted. Are you online?');
		showToast(kept ? `${before.name} is off your list. ${kept === 1 ? '1 card that counts by it keeps it' : `${kept} cards that count by it keep it`}.` : `Deleted ${before.name}.`, () => put(before));
	}
	function add() {
		fresh ??= { id: newId(), name: '', formula: '', per: 'set', combine: 'sum', unit: '', read: 'shown' };
		open[fresh.id] = true;
	}
</script>

<div class="se-sub">
	{#each shown as m (m.id)}
		<SaidLine id="m-{m.id}" label={m.name || 'New measure'} words={words(m)} bind:open={() => !!open[m.id], (v) => (open[m.id] = v)} problem={problem[m.id] || (m.formula ? (formulaProblem(m.formula) ?? '') : '')} onremove={() => remove(m)} removeLabel={fresh?.id === m.id ? 'Leave it' : `Delete ${m.name}`}>
			<div class="se-dates">
				<div class="field"><label class="label" for="mn-{m.id}">Name</label><input id="mn-{m.id}" value={m.name} maxlength="40" placeholder="Tonnage" onchange={(e) => change(m, { name: e.currentTarget.value.trim() })} /></div>
				<div class="field"><label class="label" for="mu-{m.id}">Unit</label><input id="mu-{m.id}" value={m.unit} maxlength="240" placeholder="kg" list="measure-units" onchange={(e) => change(m, { unit: e.currentTarget.value.trim() })} /></div>
			</div>
			<div class="field">
				<label class="label" for="mf-{m.id}">Formula</label>
				<textarea id="mf-{m.id}" rows="2" value={m.formula} maxlength="1000" placeholder="[Weight] * [Reps]" spellcheck="false" autocomplete="off" onchange={(e) => change(m, { formula: e.currentTarget.value.trim() })}></textarea>
				{#if missing(m)}<p class="meta">{missing(m)}</p>{/if}
			</div>
			{#if suggestions[m.id]}
				<div class="chips">
					{#each suggestions[m.id] as x (x.name)}<button type="button" class="toggle" aria-pressed={m.formula === x.formula} onclick={() => m.formula !== x.formula && change(m, { formula: x.formula })}>{x.name}</button>{/each}
				</div>
			{/if}
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
				<summary class="meta">How it reads fields, and where it shows</summary>
				<div class="l-stack more">
					<div class="option-row">
						<label class="check"><input type="checkbox" class="pick" checked={m.read === 'shown'} aria-describedby="mr-{m.id}" onchange={(e) => change(m, { read: e.currentTarget.checked ? 'shown' : 'logged' })} /> Convert first</label>
						<p class="field-hint meta" id="mr-{m.id}">Fields are read in the unit their kind is shown in. Off: as they were logged.</p>
					</div>
					{#if m.per === 'set'}<label class="check"><input type="checkbox" class="pick" checked={!!m.sets} onchange={(e) => change(m, { sets: e.currentTarget.checked || undefined })} /> Only Tasks logged in sets</label>{/if}
					<label class="check"><input type="checkbox" class="pick" checked={!!m.weigh} onchange={(e) => change(m, { weigh: e.currentTarget.checked || undefined })} /> Split by a grouping, it counts by the level</label>
					<label class="check"><input type="checkbox" class="pick" checked={m.better === 'less'} onchange={(e) => change(m, { better: e.currentTarget.checked ? 'less' : undefined })} /> Less is better</label>
					<div class="se-dates">
						<div class="field">
							<label class="label" for="mo-{m.id}">On a new card</label>
							<select id="mo-{m.id}" value={m.over ?? 'sum'} onchange={(e) => change(m, { over: e.currentTarget.value as OverTime })}>{#each Object.entries(OVER_TIME) as [k, l] (k)}<option value={k}>{l}</option>{/each}</select>
						</div>
						<div class="field">
							<label class="label" for="ma-{m.id}">A card by itself</label>
							<select id="ma-{m.id}" value={m.auto ?? ''} onchange={(e) => change(m, { auto: (e.currentTarget.value || undefined) as CustomMeasure['auto'] })}><option value="">None</option><option value="session">For each log</option><option value="week">Per week</option><option value="split">By grouping, for all of a habit's Tasks</option></select>
						</div>
						<div class="field"><label class="label" for="mx-{m.id}">Among a Task's records as</label><input id="mx-{m.id}" value={m.record ?? ''} maxlength="240" placeholder="Not listed" onchange={(e) => change(m, { record: e.currentTarget.value.trim() || undefined })} /></div>
					</div>
				</div>
			</details>
			<details>
				<summary class="meta">Fields and functions you can use</summary>
				<p class="meta">Fields, in square brackets: {#each fields as f, i (f.name)}{i ? ', ' : ''}<code>[{f.name}]</code>{/each}{fields.length ? '.' : 'none yet.'}</p>
				<p class="meta">
					Numbers, <code>+ - * / ^</code>, parentheses, and {#each Object.entries(FUNCTIONS) as [k, v], i (k)}{i ? ', ' : ''}<code>{k}()</code> ({v.charAt(0).toLowerCase() + v.slice(1)}){/each}. A missing value or a division by zero gives no number for that log, never a made-up 0.
				</p>
				<p class="meta">In the unit, <code>{'{weight}'}</code> is the unit Weight is shown in, and <code>[Distance]</code> the unit of that field.</p>
			</details>
		</SaidLine>
	{/each}
</div>
{#if !fresh}<div><button type="button" onclick={add}>+ Measure</button></div>{/if}
<datalist id="measure-units">{#each units().names() as u (u)}<option value={u}></option>{/each}{#each units().kinds as k (k.id)}<option value={`{${k.id}}`}></option>{/each}</datalist>

<style>
	p {
		margin: 0;
	}
	.more {
		--gap: var(--space-inline);
		padding-block: var(--space-inline);
	}
</style>
