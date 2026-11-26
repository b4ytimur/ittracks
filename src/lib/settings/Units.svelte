<script lang="ts">
	// Your kinds of units, each a line inside the line. What you type is saved as you leave it; what
	// can't be saved stays in its box, and the line says why.
	import { untrack } from 'svelte';
	import SaidLine from '$lib/detail/SaidLine.svelte';
	import { kindsProblem, TIME, unitTable, unitWord, type Unit, type UnitKind } from '$lib/units';

	let {
		kinds,
		used,
		problem = $bindable(''),
		onsave
	}: {
		kinds: UnitKind[];
		/** How many fields are written in each unit, by its word. */
		used: Record<string, number>;
		problem?: string;
		onsave: (kinds: UnitKind[], said: string, renames: Record<string, string>) => void;
	} = $props();

	const copy = (ks: UnitKind[]) => JSON.parse(JSON.stringify(ks)) as UnitKind[];
	let rows = $state<UnitKind[]>(untrack(() => copy(kinds)));
	let seen = untrack(() => JSON.stringify(kinds));
	$effect(() => {
		const now = JSON.stringify(kinds);
		if (now === seen) return;
		seen = now;
		untrack(() => {
			rows = copy(kinds);
			problem = '';
		});
	});
	let open = $state<Record<string, boolean>>({});

	const FIXED = ['s', 'min', 'h'];
	const table = $derived(unitTable(kinds));
	/** Fields that use this unit, by its name or another word for it. */
	const uses = (x: Unit) => Object.entries(used).reduce((n, [w, c]) => n + (table.find(w)?.id === x.id ? c : 0), 0);
	const keepers = (n: number, what: string) => (n === 1 ? `1 field that uses ${what} keeps ${what === 'it' ? 'it' : 'its own'}.` : `${n} fields that use ${what} keep ${what === 'it' ? 'it' : 'theirs'}.`);
	const baseOf = (k: UnitKind) => k.units.find((x) => x.per === 1) ?? k.units[0];
	const shownUnits = (k: UnitKind) => k.units.filter((x) => !x.off);
	const worth = (k: UnitKind, x: Unit) => String(Number((x.per / baseOf(k).per).toPrecision(8)));
	const read = (t: string) => Number(t.trim().replace(',', '.'));
	const words = (k: UnitKind) => `${shownUnits(k).map((x) => x.name || 'a new unit').join(', ')}.${k.id === TIME ? '' : ` Shown in ${k.shown || 'nothing yet'}.`}`;

	function save(next: UnitKind[], said: string, renames: Record<string, string> = {}, gone = '') {
		rows = next;
		// Half-made ones stay here until they have their names.
		const whole = next.filter((k) => k.name.trim() && k.units.some((x) => x.name.trim())).map((k) => ({ ...k, name: k.name.trim(), units: k.units.filter((x) => x.name.trim()) }));
		const lost = kinds.find((k) => k.id !== gone && !whole.some((w) => w.id === k.id));
		problem = lost ? `Not saved. ${lost.name} needs a name.` : kindsProblem(whole);
		if (problem || JSON.stringify(whole) === JSON.stringify(kinds)) return;
		onsave(whole, said, renames);
	}
	const edit = (kind: string, f: (k: UnitKind) => UnitKind) => rows.map((k) => (k.id === kind ? f($state.snapshot(k) as UnitKind) : ($state.snapshot(k) as UnitKind)));
	const editUnit = (kind: string, id: string, v: Partial<Unit>) => edit(kind, (k) => ({ ...k, units: k.units.map((x) => (x.id === id ? { ...x, ...v } : x)) }));

	function rename(k: UnitKind, x: Unit, name: string) {
		const was = kinds.find((y) => y.id === k.id)?.units.find((y) => y.id === x.id)?.name;
		if (!name && was) return void (problem = `Not saved. ${was} needs a name; × takes it off the list.`);
		// Its old name still means it, for anything written that way.
		const also = was && unitWord(was) !== unitWord(name) ? [...x.also.filter((w) => unitWord(w) !== unitWord(name)), was] : x.also;
		const next = edit(k.id, (y) => ({ ...y, shown: !y.shown || unitWord(y.shown) === unitWord(was) ? name : y.shown, units: y.units.map((z) => (z.id === x.id ? { ...z, name, also } : z)) }));
		save(next, was ? `Renamed ${was} to ${name}.` : `Added ${name}.`, was ? { [was]: name } : {});
	}
	function setWorth(k: UnitKind, x: Unit, t: string, box: HTMLInputElement) {
		const v = read(t);
		if (!(v > 0)) {
			box.value = worth(k, x);
			return void (problem = `Not saved. One ${x.name || 'unit'} is more than nothing.`);
		}
		save(editUnit(k.id, x.id, { per: v * baseOf(k).per }), `One ${x.name} is ${v} ${baseOf(k).name} now.`);
	}
	function setStep(k: UnitKind, x: Unit, t: string, box: HTMLInputElement) {
		const v = read(t);
		if (!(v > 0)) {
			box.value = String(x.step);
			return void (problem = 'Not saved. A step is more than nothing.');
		}
		save(editUnit(k.id, x.id, { step: v }), `${x.name} goes up by ${v}.`);
	}
	function remove(k: UnitKind, x: Unit) {
		const n = uses(x);
		const units = n ? k.units.map((y) => (y.id === x.id ? { ...y, off: true } : y)) : k.units.filter((y) => y.id !== x.id);
		const left = units.filter((y) => !y.off);
		const next = edit(k.id, (y) => ({ ...y, units, shown: unitWord(y.shown) === unitWord(x.name) ? (left[0]?.name ?? y.shown) : y.shown }));
		save(next, n ? `${x.name} is off your list. ${keepers(n, 'it')}` : `Removed ${x.name || 'a unit'}.`);
	}
	function removeKind(k: UnitKind) {
		const n = k.units.reduce((a, x) => a + uses(x), 0);
		save(n ? edit(k.id, (y) => ({ ...y, off: true })) : rows.filter((y) => y.id !== k.id).map((y) => $state.snapshot(y) as UnitKind), `Deleted ${k.name || 'a kind'}.${n ? ` ${keepers(n, 'its units')}` : ''}`, {}, k.id);
	}
	const addUnit = (k: UnitKind) => (rows = edit(k.id, (y) => ({ ...y, units: [...y.units, { id: crypto.randomUUID(), name: '', per: 1, step: 1, also: [] }] })));
	function addKind() {
		const id = crypto.randomUUID();
		rows = [...rows, { id, name: '', shown: '', units: [{ id: crypto.randomUUID(), name: '', per: 1, step: 1, also: [] }] }];
		open[id] = true;
	}
</script>

<div class="se-sub">
	{#each rows.filter((k) => !k.off) as k (k.id)}
		<SaidLine id="kind-{k.id}" label={k.name || 'New kind'} words={words(k)} bind:open={() => !!open[k.id], (v) => (open[k.id] = v)}>
			<div class="field"><label class="label" for="kn-{k.id}">Name</label><input id="kn-{k.id}" value={k.name} maxlength="30" placeholder="Weight, Laps, Ducks…" onchange={(e) => save(edit(k.id, (y) => ({ ...y, name: e.currentTarget.value.trim() })), kinds.some((y) => y.id === k.id) ? `Renamed ${k.name} to ${e.currentTarget.value.trim()}.` : `Added ${e.currentTarget.value.trim()}.`)} /></div>
			{#if k.id !== TIME && shownUnits(k).filter((x) => x.name).length > 1}
				<div class="field">
					<span class="label" id="shown-{k.id}">Shown in</span>
					<div class="chips" role="radiogroup" aria-labelledby="shown-{k.id}">
						{#each shownUnits(k).filter((x) => x.name) as x (x.id)}<label class="toggle"><input type="radio" class="vh" name="shown-{k.id}" checked={unitWord(k.shown) === unitWord(x.name)} onchange={() => save(edit(k.id, (y) => ({ ...y, shown: x.name })), `${k.name} is shown in ${x.name}.`)} />{x.name}</label>{/each}
					</div>
				</div>
			{/if}
			<div class="l-stack" style="--gap: var(--space-inline)">
				{#each shownUnits(k) as x (x.id)}
					{@const base = baseOf(k)}
					{@const fixed = k.id === TIME && FIXED.includes(x.name)}
					<div class="se-unit">
						{#if fixed}<span class="fixed">{x.name}</span><span class="meta muted se-eq">the clocks need it</span>
						{:else}
							<input value={x.name} maxlength="20" placeholder="kg, lap, duck…" aria-label="Name of {x.name ? `the unit ${x.name}` : 'the new unit'}" onchange={(e) => rename(k, x, e.currentTarget.value.trim())} />
							{#if x.id === base.id}<span class="meta muted se-eq">{shownUnits(k).length > 1 ? 'the base of its kind' : 'one of its kind'}</span>
							{:else}
								<span class="se-eq" aria-hidden="true">=</span><input class="num se-to" inputmode="decimal" value={worth(k, x)} aria-label="One {x.name || 'new unit'} is this many {base.name}" onchange={(e) => setWorth(k, x, e.currentTarget.value, e.currentTarget)} /><span class="meta muted">{base.name}</span>
							{/if}
						{/if}
						<label class="step meta">± <input class="num" inputmode="decimal" value={x.step} aria-label="Step of {x.name || 'the new unit'} on the log" onchange={(e) => setStep(k, x, e.currentTarget.value, e.currentTarget)} /></label>
						{#if !fixed && (x.id !== base.id || !x.name)}<button type="button" class="quiet glyph" aria-label="Remove {x.name || 'the new unit'}" onclick={() => remove(k, x)}>×</button>{/if}
					</div>
				{/each}
			</div>
			<div class="l-cluster">
				<button type="button" onclick={() => addUnit(k)}>+ Unit</button>
				{#if k.id !== TIME}<button type="button" class="quiet se-del" onclick={() => removeKind(k)}>Delete {k.name || 'it'}</button>{/if}
			</div>
		</SaidLine>
	{/each}
</div>
<div><button type="button" onclick={addKind}>+ Kind</button></div>

<style>
	.fixed {
		flex: 1 1 8rem;
	}
	.step {
		display: inline-flex;
		align-items: center;
		gap: var(--space-tight);
		margin: 0;
	}
	.step input {
		width: 4rem;
	}
</style>
