<script lang="ts">
	import { describeSchedule } from '$lib/describe';
	import { forest } from '$lib/engine/tree';
	import { onDestroy, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { invalidateAll } from '$app/navigation';
	import ViewBar from '$lib/ViewBar.svelte';
	import EditableList from '$lib/ui/EditableList.svelte';
	import AreaGroups from '$lib/ui/AreaGroups.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import StatusTag from '$lib/ui/StatusTag.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import BulkBar from '$lib/bulk/BulkBar.svelte';
	import { moveKey, reorderFrom, type Mode, type Move } from '$lib/ui/list';
	import { isFollow, isGroup } from '$lib/engine/schedule';
	import { saveLayout, viewOp } from '$lib/viewclient';
	import { runAction, showToast, undoWith } from '$lib/toast.svelte';
	import { HABIT_LINES, groupBy, manualOrder, passes, type HabitLineKey } from '$lib/views';

	let { data } = $props();

	type Habit = (typeof data.habits)[number];
	/** The list as shown, changed at once by edits here and refreshed from the server after. */
	let habits = $derived(data.habits);
	/** One of three on this same page. Editing: drag to reorder, rename in place, archive. Selecting: change several together. */
	let mode = $state<Mode>('use');
	const selected = new SvelteSet<string>();
	let outcome = $state(new Map<string, { tag?: string; reason?: string }>());
	/** Archived while editing: they stay in the list, struck, until editing ends. */
	const struck = new SvelteSet<string>();
	const areaOptions = $derived(data.areas.map((a) => ({ value: a.id, label: a.name })));

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
		const before = views.habits;
		views.habits = { ...views.habits, lines };
		saveLayout({ op: 'patch', habits: { lines } }, () => (views.habits = before), () => toggleLine(k));
	}

	const area = (id: string | null) => data.areas.find((a) => a.id === id);
	/** "My order": one order of habits, shared with Today. */
	const mine = (list: Habit[]) => manualOrder(list, views.today.order, (h) => h.id);
	const shown = $derived.by(() => {
		const list = habits.filter((h) => (view.archived || !h.archived || struck.has(h.id)) && passes(view, h));
		if (view.sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name));
		if (view.sort === 'consistency') return [...list].sort((a, b) => (b.consistency ?? -1) - (a.consistency ?? -1));
		if (view.sort === 'created') return [...list].sort((a, b) => b.createdAt - a.createdAt);
		return mine(list);
	});
	const groups = $derived(groupBy(shown, view.group, { areas: data.areas }, { keepEmpty: mode === 'edit' }));
	const identityNames = $derived([...new Set(habits.flatMap((h) => h.identities))].sort());

	/**
	 * A list of siblings was reordered. It goes into the one shared order in the places those
	 * habits held. Dragging in another sort starts from what you see, then switches to My order.
	 */
	function reorder(part: string[], said: string) {
		const order = reorderFrom(mine(habits).map((h) => h.id), shown.map((h) => h.id), part, view.sort === 'manual');
		const before = { today: views.today, sort: view.sort };
		views.today = { ...views.today, order };
		if (view.sort !== 'manual') {
			view.sort = 'manual';
			said += ' Sorted by My order, shared with Today.';
		}
		const back = () => {
			views.today = { ...views.today, order: before.today.order };
			view.sort = before.sort;
		};
		void saveLayout({ op: 'patch', today: { order } }, back, () => void reorder(part, said)).then(
			(ok) =>
				ok &&
				showToast(said, async () => {
					back();
					return !!(await viewOp({ op: 'patch', today: { order: before.today.order } }));
				})
		);
		return true;
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
		const r = await runAction('/habits?/move', { id, parent: parentId ?? '' });
		if (!r.ok) {
			habits = habits.map((x) => (x.id === id ? { ...x, parentId: was.parentId } : x));
			views.today = { ...views.today, order: was.order };
			return showToast(r.error ?? "Couldn't move it. Are you online?");
		}
		saveLayout({ op: 'patch', today: { order } }, () => (views.today = { ...views.today, order: was.order }));
		showToast(done, async () => {
			if (!(await runAction('/habits?/move', { id, parent: was.parentId ?? '' })).ok) return false;
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
		const r = await runAction('/habits?/rename', { id: h.id, name });
		if (!r.ok) {
			habits = habits.map((x) => (x.id === h.id ? { ...x, name: before } : x));
			return showToast(r.error ?? "Couldn't rename it. Are you online?");
		}
		showToast(`Renamed to “${name}”.`, undoWith('/habits?/rename', { id: h.id, name: before }));
	}

	async function archive(h: Habit) {
		const to = !h.archived;
		habits = habits.map((x) => (x.id === h.id ? { ...x, archived: to } : x));
		const r = await runAction(to ? '/habits?/archive' : '/habits?/unarchive', { id: h.id });
		if (!r.ok) {
			habits = habits.map((x) => (x.id === h.id ? { ...x, archived: !to } : x));
			return showToast(r.error ?? "Couldn't change it. Are you online?");
		}
		// The row shows its own way back until editing ends.
		if (to) struck.add(h.id);
		else if (!struck.delete(h.id)) showToast(`${h.name} is back.`, undoWith('/habits?/archive', { id: h.id }));
	}
	/** Editing ended: the struck rows go, and the band can bring them back. */
	function leave() {
		const gone = habits.filter((h) => struck.has(h.id));
		struck.clear();
		if (!gone.length) return;
		if (navigator.onLine) invalidateAll();
		showToast(`Archived ${gone.length === 1 ? gone[0].name : `${gone.length} habits`}. ${gone.length === 1 ? 'Its' : 'Their'} logs are kept.`, async () => {
			let ok = true;
			for (const h of gone) ok = (await runAction('/habits?/unarchive', { id: h.id })).ok && ok;
			return ok;
		});
	}
	// Leaving the page ends editing too.
	onDestroy(leave);
	const setMode = (m: Mode) => {
		if (mode === 'edit' && m !== 'edit') leave();
		mode = m;
	};
	const cueText = (c: { time: string | null; range?: string | null } | null) => c?.time ?? c?.range ?? null;
	const ago = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	const lineFor = (h: (typeof data.habits)[number]) => {
		const a = area(h.areaId);
		return [
			show('schedule') ? (h.direction === 'break' ? 'Break habit' : (isGroup(h.schedule) || !h.holds || !habits.some((x) => x.parentId === h.id) ? '' : 'Routine · ') + describeSchedule(h.schedule, data.habits.find((x) => x.id === h.parentId), h.variants)) : null,
			show('cue') ? cueText(h.cue) : null,
			show('area') && a && view.group !== 'area' ? `${a.name}` : null,
			show('consistency') && h.consistency !== null ? `${h.consistency}% in 30 days` : null,
			show('last') && h.direction !== 'break' ? (h.lastDone ? `last done ${ago(h.lastDone)}` : 'not done yet') : null
		]
			.filter(Boolean)
			.join(' · ');
	};
</script>

<svelte:head><title>Habits · ittracks</title></svelte:head>

<EditChrome
	title="Habits"
	{mode}
	modes={['use', 'edit', 'select']}
	onmode={setMode}
	hints={{
		use: `${shown.length} ${shown.length === 1 ? 'habit' : 'habits'}`,
		edit: 'Drag ⠿ to reorder: sideways puts a habit inside the group or routine above it, or takes it out. Tap a name to rename it. The order is shared with Today.',
		select: 'Tick habits to change them together.'
	}}
>
	{#snippet actions()}
		{#if !views.hidden.includes('identities')}<a class="button" href="/identities">Identities</a>{/if}
		<a class="button" href="/gallery">Gallery</a>
		<a class="button primary" href="/habits/new">New habit</a>
	{/snippet}
</EditChrome>

{#if data.added}
	<p class="card added">
		Added "{data.added}"{data.inside ? ` and the ${data.inside === 1 ? 'habit' : `${data.inside} habits`} inside it` : ''}{data.created ? ` with ${data.created} new ${data.created === 1 ? 'Task' : 'Tasks'}` : ''}{data.reused
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
	<EmptyState text="A habit can be something to build, like a gym plan or language practice, or something to break, like smoking. Pick a ready-made one from the Gallery or make your own." />
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
		<fieldset>
			<legend class="small-text">Lines on each habit</legend>
			{#each Object.entries(HABIT_LINES) as [k, label] (k)}
				<label style="color: var(--ink)"
					><input type="checkbox" checked={show(k as HabitLineKey)} onchange={() => toggleLine(k as HabitLineKey)} /> {label}</label
				>
			{/each}
		</fieldset>
	</ViewBar>
	{#if !shown.length}<EmptyState kind="filtered" text="No habits match these filters." />{/if}
{/if}

{#if mode === 'select'}
	<BulkBar kind="habit" {selected} bind:outcome visible={shown.map((h) => h.id)} today={data.today} sources={{ areas: areaOptions }} />
{/if}

<AreaGroups {groups} areas={data.areas} {mode} byArea={view.group === 'area'}>
	{#snippet group(g)}
		<!-- A habit inside a group sits in a list of its own under it; one whose group isn't listed sits at the top. -->
		{@const tree = forest(g.items)}
		{@render habitList(tree.roots, tree.kids, g.label || 'Habits', null)}
	{/snippet}
</AreaGroups>

{#snippet habitList(items: Habit[], kids: Map<string, Habit[]>, name: string, holder: Habit | null)}
	<EditableList
		{items}
		key={(h) => h.id}
		label={(h) => h.name}
		{mode}
		{selected}
		rowCard
		holder={(h) => !!kids.get(h.id)?.length}
		href={(h) => `/habits/${h.id}`}
		selectScope={(h) => (kids.get(h.id)?.length ? 'unit' : 'item')}
		childKeys={(k) => (kids.get(k) ?? []).map((x) => x.id)}
		itemClass={(h) => (struck.has(h.id) ? 'struck' : '')}
		ariaLabel={name}
		{canDrop}
		onmove={(m, order, text) => (m.position === 'inside' ? (indent(m.key, m.target), true) : reorder(order, text))}
		onoutdent={holder ? (k) => outdent(k, holder) : undefined}
		onremove={archive}
		removeLabel={(h) => (h.archived ? 'Unarchive' : 'Archive')}
	>
		{#snippet row(h)}
			{@const o = outcome.get(h.id)}
			{#if mode === 'use'}<a class="name" href="/habits/{h.id}">{h.name}</a>
			{:else}<span class="name"><InlineText value={h.name} editing={mode === 'edit' && !struck.has(h.id)} label="Name of {h.name}" maxlength={120} onsave={(v) => rename(h, v)} /></span>{/if}
			{#if o?.tag}<span class="tags"><span class="tag pending"><span aria-hidden="true">→</span> {o.tag}</span></span>
			{:else if h.archived}<span class="tags"><StatusTag status="archived" /></span>{/if}
			{#if o?.reason || lineFor(h)}<p class="meta-line label">{o?.reason ?? lineFor(h)}</p>{/if}
		{/snippet}
		{#snippet children(h)}
			{#if kids.get(h.id)?.length}
				{@render habitList(kids.get(h.id)!, kids, `Inside ${h.name}`, h)}
			{/if}
		{/snippet}
	</EditableList>
{/snippet}

<p style="margin-top: 1rem"><a class="button" href="/habits/import">Import a template file</a></p>

<style>
	.added {
		border-color: var(--accent);
		margin-bottom: 0.75rem;
	}
	fieldset {
		border: 1px solid var(--line);
		border-radius: var(--radius-inset);
	}
</style>
