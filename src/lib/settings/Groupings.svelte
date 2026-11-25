<script lang="ts">
	// Your groupings, each a line inside the line: its members, and its levels with what each counts.
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import SaidLine from '$lib/detail/SaidLine.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import { groupingsProblem, type Grouping, type GroupingLevel } from '$lib/groupings';
	import { runAction, showToast, undoWith } from '$lib/toast.svelte';

	let {
		groupings,
		tags,
		problem = $bindable(''),
		onsave
	}: {
		groupings: Grouping[];
		/** Every tag, the grouping it is in (null: the first), and the level each Task has it at. */
		tags: { id: string; name: string; grouping: string | null; levels: number[] }[];
		problem?: string;
		onsave: (groupings: Grouping[], said: string) => void;
	} = $props();

	const copy = (gs: Grouping[]) => JSON.parse(JSON.stringify(gs)) as Grouping[];
	let rows = $state<Grouping[]>(untrack(() => copy(groupings)));
	let seen = untrack(() => JSON.stringify(groupings));
	$effect(() => {
		const now = JSON.stringify(groupings);
		if (now === seen) return;
		seen = now;
		untrack(() => {
			rows = copy(groupings);
			problem = '';
		});
	});
	let open = $state<Record<string, boolean>>({});
	let adding = $state<Record<string, string>>({});

	const membersOf = (g: Grouping) => tags.filter((t) => (groupings.some((x) => x.id === t.grouping) ? t.grouping : groupings[0].id) === g.id);
	const tasks = (n: number) => `${n} ${n === 1 ? 'Task' : 'Tasks'}`;
	const inUse = (g: Grouping, l: GroupingLevel) => membersOf(g).reduce((n, t) => n + t.levels.filter((x) => x === l.id).length, 0);
	const used = (g: Grouping) => membersOf(g).reduce((n, t) => n + t.levels.length, 0);
	const shown = (g: Grouping) => g.levels.filter((l) => !l.off);
	const words = (g: Grouping) => {
		const n = membersOf(g).length;
		return `${n} ${n === 1 ? g.one || 'member' : 'members'}. ${shown(g).filter((l) => l.name).map((l) => `${l.name} ${l.weight}`).join(', ') || 'No levels yet'}.`;
	};

	function save(next: Grouping[], said: string, gone = '') {
		rows = next;
		// Half-made ones stay here until they have their names.
		const whole = next
			.filter((g) => g.name.trim() && g.levels.some((l) => l.name.trim()))
			.map((g) => ({ ...g, name: g.name.trim(), one: g.one.trim() || g.name.trim().toLowerCase(), levels: g.levels.filter((l) => l.name.trim()) }));
		const lost = groupings.find((g) => g.id !== gone && !whole.some((w) => w.id === g.id));
		problem = lost ? `Not saved. ${lost.name} needs a name.` : groupingsProblem(whole);
		if (problem || JSON.stringify(whole) === JSON.stringify(groupings)) return;
		onsave(whole, said);
	}
	const edit = (id: string, f: (g: Grouping) => Grouping) => rows.map((g) => (g.id === id ? f($state.snapshot(g) as Grouping) : ($state.snapshot(g) as Grouping)));
	const editLevel = (id: string, level: number, v: Partial<GroupingLevel>) => edit(id, (g) => ({ ...g, levels: g.levels.map((l) => (l.id === level ? { ...l, ...v } : l)) }));
	const isNew = (g: Grouping) => !groupings.some((x) => x.id === g.id);

	function renameLevel(g: Grouping, l: GroupingLevel, name: string) {
		const was = groupings.find((x) => x.id === g.id)?.levels.find((x) => x.id === l.id)?.name;
		if (!name && was) return void (problem = `Not saved. ${was} needs a name; × takes it off the list.`);
		save(editLevel(g.id, l.id, { name }), was ? `Renamed ${was} to ${name}.` : `Added the level ${name}.`);
	}
	function weigh(g: Grouping, l: GroupingLevel, box: HTMLInputElement) {
		const v = Number(box.value.trim().replace(',', '.'));
		if (!box.value.trim() || !(v >= 0)) {
			box.value = String(l.weight);
			return void (problem = 'Not saved. A level counts nothing or more.');
		}
		save(editLevel(g.id, l.id, { weight: v }), `${l.name} counts ${v} now.`);
	}
	function removeLevel(g: Grouping, l: GroupingLevel) {
		const n = inUse(g, l);
		save(edit(g.id, (x) => ({ ...x, levels: n ? x.levels.map((y) => (y.id === l.id ? { ...y, off: true } : y)) : x.levels.filter((y) => y.id !== l.id) })), n ? `${l.name} is off the list. ${n === 1 ? '1 Task that has it keeps it.' : `${n} Tasks that have it keep it.`}` : `Removed the level ${l.name || ''}.`);
	}
	const addLevel = (g: Grouping) => (rows = edit(g.id, (x) => ({ ...x, levels: [...x.levels, { id: Math.max(0, ...x.levels.map((l) => l.id)) + 1, name: '', weight: 0 }] })));
	function addGrouping() {
		const id = crypto.randomUUID();
		rows = [...rows, { id, name: '', one: '', levels: [{ id: 1, name: 'main', weight: 1 }] }];
		open[id] = true;
	}

	async function addMember(g: Grouping) {
		const name = (adding[g.id] ?? '').trim();
		if (!name) return;
		const r = await runAction<{ id: string }>('/settings?/addTag', { name, grouping: g.id });
		if (!r.ok) return void (problem = r.error ?? 'Not added. Are you online?');
		problem = adding[g.id] = '';
		showToast(`Added ${name} to ${g.name}.`, undoWith('/settings?/removeTag', { id: r.data!.id }));
		await invalidateAll();
	}
	async function removeMember(g: Grouping, t: (typeof tags)[number]) {
		const r = await runAction('/settings?/removeTag', { id: t.id });
		if (!r.ok) return void (problem = r.error ?? 'Not removed. Are you online?');
		problem = '';
		showToast(`Removed ${t.name}.`, undoWith('/settings?/addTag', { name: t.name, grouping: g.id }));
		await invalidateAll();
	}
	async function renameMember(t: (typeof tags)[number], name: string) {
		const r = await runAction<{ was: string; name: string }>('/settings?/renameTag', { id: t.id, name });
		if (!r.ok) return void (problem = r.error ?? 'Not renamed. Are you online?');
		problem = '';
		showToast(`Renamed ${r.data!.was} to ${r.data!.name}, also in rules and filters.`, undoWith('/settings?/renameTag', { id: t.id, name: r.data!.was }));
		await invalidateAll();
	}
	async function moveMember(t: (typeof tags)[number], to: string) {
		const r = await runAction<{ was: string }>('/settings?/moveTag', { id: t.id, grouping: to });
		if (!r.ok) return void (problem = r.error ?? 'Not moved. Are you online?');
		problem = '';
		showToast(`${t.name} is in ${groupings.find((g) => g.id === to)?.name} now.`, undoWith('/settings?/moveTag', { id: t.id, grouping: r.data!.was }));
		await invalidateAll();
	}
</script>

<div class="se-sub">
	{#each rows as g (g.id)}
		<SaidLine id="grouping-{g.id}" label={g.name || 'New grouping'} words={words(g)} bind:open={() => !!open[g.id], (v) => (open[g.id] = v)}>
			<div class="se-dates">
				<div class="field"><label class="label" for="gn-{g.id}">Name</label><input id="gn-{g.id}" value={g.name} maxlength="40" placeholder="Muscle groups, Skills, Rooms…" onchange={(e) => save(edit(g.id, (x) => ({ ...x, name: e.currentTarget.value.trim() })), isNew(g) ? `Added ${e.currentTarget.value.trim()}.` : `Renamed ${g.name} to ${e.currentTarget.value.trim()}.`)} /></div>
				<div class="field"><label class="label" for="go-{g.id}">One is called</label><input id="go-{g.id}" value={g.one} maxlength="40" placeholder="muscle group" onchange={(e) => save(edit(g.id, (x) => ({ ...x, one: e.currentTarget.value.trim() })), `One of ${g.name} is called ${e.currentTarget.value.trim()}.`)} /></div>
			</div>
			{#if !isNew(g)}
				<div class="field">
					<span class="label">Members</span>
					{#each membersOf(g) as t (t.id)}
						<div class="act-row">
							<span class="status-text"><InlineText editing value={t.name} label="Name of {g.one || 'the member'}" maxlength={40} onsave={(v) => renameMember(t, v)} /> <span class="muted meta">· {t.levels.length ? tasks(t.levels.length) : 'no Task yet'}</span></span>
							{#if groupings.length > 1}
								<label class="vh" for="gm-{t.id}">Grouping of {t.name}</label>
								<select id="gm-{t.id}" class="move" value={g.id} onchange={(e) => moveMember(t, e.currentTarget.value)}>{#each groupings as x (x.id)}<option value={x.id}>{x.name}</option>{/each}</select>
							{/if}
							{#if !t.levels.length}<button type="button" class="quiet hit" aria-label="Remove {t.name}" onclick={() => removeMember(g, t)}>×</button>{/if}
						</div>
					{/each}
					<form class="se-unit" onsubmit={(e) => (e.preventDefault(), addMember(g))}>
						<input bind:value={adding[g.id]} maxlength="40" placeholder="New {g.one || 'member'}" aria-label="New member of {g.name}" />
						<button class="hit">+ Add</button>
					</form>
				</div>
			{/if}
			<div class="l-stack" style="--gap: var(--space-inline)">
				<span class="label">Levels, strongest first</span>
				{#each shown(g) as l (l.id)}
					<div class="se-unit">
						<input value={l.name} maxlength="30" placeholder="main, also, a little…" aria-label="Name of {l.name ? `the level ${l.name}` : 'the new level'}" onchange={(e) => renameLevel(g, l, e.currentTarget.value.trim())} />
						<span class="meta muted se-eq">counts</span><input class="num se-to" inputmode="decimal" value={l.weight} aria-label="{l.name || 'The new level'} counts" onchange={(e) => weigh(g, l, e.currentTarget)} />
						{#if shown(g).length > 1 || !l.name}<button type="button" class="quiet hit" aria-label="Remove {l.name || 'the new level'}" onclick={() => removeLevel(g, l)}>×</button>{/if}
					</div>
				{/each}
			</div>
			<div class="l-cluster">
				<button type="button" class="hit" onclick={() => addLevel(g)}>+ Level</button>
				{#if rows.length > 1 && !used(g)}<button type="button" class="quiet hit se-del" onclick={() => save(rows.filter((x) => x.id !== g.id).map((x) => $state.snapshot(x) as Grouping), `Deleted ${g.name || 'a grouping'}.`, g.id)}>Delete {g.name || 'it'}</button>{/if}
			</div>
			{#if rows.length > 1 && used(g)}<p class="meta muted">Tasks have its members, so it can't be deleted. Move them to another grouping first.</p>{/if}
		</SaidLine>
	{/each}
</div>
<div><button type="button" class="hit" onclick={addGrouping}>+ Grouping</button></div>

<style>
	/* A member's name and its count share a line: the rule is as wide as the name. */
	.status-text {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-tight);
	}
	.status-text > :global(button.inline-text)::after {
		width: 0;
	}
	p {
		margin: 0;
	}
	.move {
		width: auto;
		max-width: 10rem;
	}
</style>
