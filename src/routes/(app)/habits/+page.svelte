<script lang="ts">
	import { describeSchedule } from '$lib/describe';
	import { forest } from '$lib/engine/tree';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { invalidateAll } from '$app/navigation';
	import ViewBar from '$lib/ViewBar.svelte';
	import EditableList from '$lib/ui/EditableList.svelte';
	import EditButton from '$lib/ui/EditButton.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import BulkBar from '$lib/bulk/BulkBar.svelte';
	import { moveKey, reorderFrom, type Move } from '$lib/ui/list';
	import { isFollow, isGroup } from '$lib/engine/schedule';
	import { viewOp } from '$lib/viewclient';
	import { runAction, showToast } from '$lib/toast.svelte';
	import { HABIT_LINES, groupBy, manualOrder, passes, type HabitLineKey } from '$lib/views';

	let { data } = $props();

	type Habit = (typeof data.habits)[number];
	/** The list as shown, changed at once by edits here and refreshed from the server after. */
	let habits = $derived(data.habits);
	/** Edit mode is a flag on this same page: drag to reorder, rename in place, archive. */
	let editing = $state(false);
	/** So is selecting: tick habits, then change them together from the bulk bar. One mode at a time. */
	let selecting = $state(false);
	const selected = new SvelteSet<string>();
	const areaOptions = $derived(data.areas.map((a) => ({ value: a.id, label: `${a.icon} ${a.name}`.trim() })));

	let views = $state(untrack(() => data.views));
	let viewDismissed = $state(false);
	async function switchView(id: string, name: string) {
		const r = await viewOp({ op: 'template', id });
		if (!r) return showToast("Couldn't switch. Are you online?");
		const before = r.previous;
		views = r.views;
		viewDismissed = true;
		showToast(`Switched to ${name}.`, async () => {
			const back = await viewOp({ op: 'restore', views: before });
			if (back) views = back.views;
		});
	}
	let view = $state(untrack(() => data.initial));
	const show = (k: HabitLineKey) => views.habits.lines.includes(k);
	function toggleLine(k: HabitLineKey) {
		const lines = show(k) ? views.habits.lines.filter((x) => x !== k) : [...views.habits.lines, k];
		views.habits = { ...views.habits, lines };
		viewOp({ op: 'patch', habits: { lines } });
	}

	const area = (id: string | null) => data.areas.find((a) => a.id === id);
	/** "My order": one order of habits, shared with Today. */
	const mine = (list: Habit[]) => manualOrder(list, views.today.order, (h) => h.id);
	const shown = $derived.by(() => {
		const list = habits.filter((h) => (view.archived || !h.archived) && passes(view, h));
		if (view.sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name));
		if (view.sort === 'consistency') return [...list].sort((a, b) => (b.consistency ?? -1) - (a.consistency ?? -1));
		if (view.sort === 'created') return [...list].sort((a, b) => b.createdAt - a.createdAt);
		return mine(list);
	});
	const groups = $derived(groupBy(shown, view.group, { areas: data.areas }));
	const identityNames = $derived([...new Set(habits.flatMap((h) => h.identities))].sort());

	/**
	 * A list of siblings was reordered. It goes into the one shared order in the places those
	 * habits held. Dragging in another sort starts from what you see, then switches to My order.
	 */
	function reorder(part: string[]) {
		const order = reorderFrom(mine(habits).map((h) => h.id), shown.map((h) => h.id), part, view.sort === 'manual');
		views.today = { ...views.today, order };
		viewOp({ op: 'patch', today: { order } });
		if (view.sort !== 'manual') {
			view.sort = 'manual';
			showToast('Sorted by My order, shared with Today.');
		}
	}

	const byId = (id: string) => habits.find((h) => h.id === id);
	/**
	 * Which drops edit mode offers: before and after always; inside only a group or a routine
	 * (a build habit with no Tasks of its own), for a build habit. A group only goes in a group,
	 * and a habit that follows its routine's schedule only in a routine. The server checks again.
	 */
	function canDrop(m: Move) {
		if (m.position !== 'inside') return true;
		const h = byId(m.key);
		const into = byId(m.target);
		if (!h || !into || h.direction !== 'build' || !into.holds || into.archived) return false;
		if (isGroup(h.schedule) && !isGroup(into.schedule)) return false;
		return !(isFollow(h.schedule) && isGroup(into.schedule));
	}

	/**
	 * Indent and outdent: put a habit inside another (at the end of what it holds) or out to the
	 * level of the habit that held it (just after it). Saved at once, with Undo.
	 */
	async function moveTo(id: string, parentId: string | null, after: string, done: string) {
		const h = byId(id);
		if (!h) return;
		const was = { parentId: h.parentId, order: views.today.order };
		const order = moveKey(mine(habits).map((x) => x.id), id, after, 'after');
		habits = habits.map((x) => (x.id === id ? { ...x, parentId } : x));
		views.today = { ...views.today, order };
		const r = await runAction('?/move', { id, parent: parentId ?? '' });
		if (!r.ok) {
			habits = habits.map((x) => (x.id === id ? { ...x, parentId: was.parentId } : x));
			views.today = { ...views.today, order: was.order };
			return showToast(r.error ?? "Couldn't move it. Are you online?");
		}
		viewOp({ op: 'patch', today: { order } });
		showToast(done, async () => {
			await runAction('?/move', { id, parent: was.parentId ?? '' });
			views.today = { ...views.today, order: was.order };
			viewOp({ op: 'patch', today: { order: was.order } });
			await invalidateAll();
		});
	}
	function indent(id: string, into: string) {
		const last = mine(habits.filter((x) => x.parentId === into && x.id !== id)).at(-1);
		moveTo(id, into, last?.id ?? into, `Moved ${byId(id)?.name} into ${byId(into)?.name}.`);
	}
	function outdent(id: string, from: Habit) {
		moveTo(id, from.parentId, from.id, `Moved ${byId(id)?.name} out of ${from.name}.`);
	}

	async function rename(h: Habit, name: string) {
		const before = h.name;
		habits = habits.map((x) => (x.id === h.id ? { ...x, name } : x));
		const r = await runAction('?/rename', { id: h.id, name });
		if (!r.ok) {
			habits = habits.map((x) => (x.id === h.id ? { ...x, name: before } : x));
			return showToast(r.error ?? "Couldn't rename it. Are you online?");
		}
		showToast(`Renamed to “${name}”.`, async () => {
			await runAction('?/rename', { id: h.id, name: before });
			await invalidateAll();
		});
	}

	async function archive(h: Habit) {
		const to = !h.archived;
		habits = habits.map((x) => (x.id === h.id ? { ...x, archived: to } : x));
		const r = await runAction(to ? '?/archive' : '?/unarchive', { id: h.id });
		if (!r.ok) {
			habits = habits.map((x) => (x.id === h.id ? { ...x, archived: !to } : x));
			return showToast(r.error ?? "Couldn't change it. Are you online?");
		}
		showToast(to ? `Archived ${h.name}. Its logs are kept.` : `${h.name} is back.`, async () => {
			await runAction(to ? '?/unarchive' : '?/archive', { id: h.id });
			await invalidateAll();
		});
	}
	const cueText = (c: { time: string | null; range?: string | null } | null) => c?.time ?? c?.range ?? null;
	const ago = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	const lineFor = (h: (typeof data.habits)[number]) => {
		const a = area(h.areaId);
		return [
			show('schedule') ? (h.direction === 'break' ? 'Break habit' : describeSchedule(h.schedule, data.habits.find((x) => x.id === h.parentId), h.variants)) : null,
			show('cue') ? cueText(h.cue) : null,
			show('area') && a && view.group !== 'area' ? `${a.icon} ${a.name}` : null,
			show('consistency') && h.consistency !== null ? `${h.consistency}% in 30 days` : null,
			show('last') && h.direction !== 'break' ? (h.lastDone ? `last done ${ago(h.lastDone)}` : 'not done yet') : null
		]
			.filter(Boolean)
			.join(' · ');
	};
</script>

<svelte:head><title>Habits · ittracks</title></svelte:head>

<header class="bar">
	<h1>Habits</h1>
	<div class="row" style="align-items: center">
		{#if !views.hidden.includes('identities')}<a href="/identities">Identities</a>{/if}
		<a href="/gallery">Gallery</a>
		<a class="button primary" href="/habits/new" data-sveltekit-reload>New habit</a>
	</div>
</header>

{#if data.added}
	<p class="card added">
		Added "{data.added}"{data.created ? ` with ${data.created} new ${data.created === 1 ? 'Task' : 'Tasks'}` : ''}{data.reused
			? `${data.created ? ',' : ''} using ${data.reused} from your Library`
			: ''}. It's on Today when it's due.
	</p>
{/if}
{#if data.suggestView && !viewDismissed}
	{@const sv = data.suggestView}
	<div class="card added stack">
		<span>This habit works well with the <strong>{sv.name}</strong> view. {sv.summary}</span>
		<div class="row">
			<button class="small primary" onclick={() => switchView(sv.id, sv.name)}>Switch to {sv.name}</button>
			<button class="small" onclick={() => (viewDismissed = true)}>No thanks</button>
		</div>
	</div>
{/if}

{#if habits.length === 0}
	<p class="muted">
		A habit can be something to build, like a gym plan or language practice, or something to
		break, like smoking. <a href="/gallery">Pick a ready-made one</a> or <a href="/habits/new" data-sveltekit-reload>create your own</a>.
	</p>
{/if}

{#if habits.length}
	<ViewBar
		page="habits"
		bind:views
		bind:current={view}
		areas={data.areas}
		identities={views.hidden.includes('identities') ? [] : identityNames}
		direction
		archived
	>
		{#snippet end()}
			<EditButton bind:editing look="chip" onchange={(on) => on && (selecting = false)} />
			<EditButton bind:editing={selecting} label="Select" look="chip" onchange={(on) => on && (editing = false)} />
		{/snippet}
		<fieldset>
			<legend class="small-text">Lines on each habit</legend>
			{#each Object.entries(HABIT_LINES) as [k, label] (k)}
				<label style="color: var(--text)"
					><input type="checkbox" checked={show(k as HabitLineKey)} onchange={() => toggleLine(k as HabitLineKey)} /> {label}</label
				>
			{/each}
		</fieldset>
	</ViewBar>
	{#if !shown.length}<p class="muted">No habits match these filters.</p>{/if}
{/if}

{#if editing}
	<p class="muted small-text">
		Drag ⠿ to reorder, tap a name to rename it. This is My order, shared with Today. Drop a habit on a group or routine to put it
		inside, or drag it left to take it out.
	</p>
{/if}
{#if selecting}
	<BulkBar kind="habit" {selected} visible={shown.map((h) => h.id)} today={data.today} sources={{ areas: areaOptions }} />
{/if}

{#each groups as g (g.key)}
	{#if g.label}
		<h2 class="area" style="--c: {g.color ?? 'var(--border)'}">{g.label}</h2>
	{/if}
	<!-- A habit inside a group sits in a list of its own under it; one whose group isn't listed sits at the top. -->
	{@const tree = forest(g.items)}
	{@render habitList(tree.roots, tree.kids, g.label || 'Habits', null)}
{/each}

{#snippet habitList(items: Habit[], kids: Map<string, Habit[]>, name: string, holder: Habit | null)}
	<EditableList
		{items}
		key={(h) => h.id}
		label={(h) => h.name}
		{editing}
		{selecting}
		{selected}
		ariaLabel={name}
		{canDrop}
		onmove={(m, order) => (m.position === 'inside' ? indent(m.key, m.target) : reorder(order))}
		onoutdent={holder ? (k) => outdent(k, holder) : undefined}
		onremove={archive}
		removeLabel={(h) => (h.archived ? 'Unarchive' : 'Archive')}
	>
		{#snippet row(h)}
			{@const a = area(h.areaId)}
			{#if editing}
				<div class="card habit" style="--c: {a?.color ?? 'transparent'}">
					<strong><InlineText value={h.name} {editing} label="Name of {h.name}" maxlength={120} onsave={(v) => rename(h, v)} /></strong>
					{#if h.archived}<span class="chip">Archived</span>{/if}
					{#if lineFor(h)}<div class="muted" style="font-size: 0.9rem">{lineFor(h)}</div>{/if}
				</div>
			{:else}
				<a class="card habit" href="/habits/{h.id}" data-sveltekit-reload style="--c: {a?.color ?? 'transparent'}">
					<strong>{h.name}</strong>
					{#if h.archived}<span class="chip">Archived</span>{/if}
					{#if lineFor(h)}<div class="muted" style="font-size: 0.9rem">{lineFor(h)}</div>{/if}
				</a>
			{/if}
		{/snippet}
		{#snippet children(h)}
			{#if kids.get(h.id)?.length}
				<div class="inside">{@render habitList(kids.get(h.id)!, kids, `Inside ${h.name}`, h)}</div>
			{/if}
		{/snippet}
	</EditableList>
{/snippet}

<p style="margin-top: 1rem"><a class="button" href="/habits/import">Import a template file</a></p>

<style>
	.habit {
		border-left: 4px solid var(--c);
	}
	.added {
		border-color: var(--accent);
		margin-bottom: 0.75rem;
	}
	h2.area {
		border-left: 4px solid var(--c);
		padding-left: 0.5rem;
	}
	.small-text {
		font-size: 0.85rem;
	}
	fieldset {
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.chip {
		margin-left: 0.35rem;
	}
	.inside {
		margin: 0.5rem 0 0 1.25rem;
	}
</style>
