<script lang="ts">
	import { describeAsks, describeSchedule } from '$lib/describe';
	import { forest } from '$lib/engine/tree';
	import { onDestroy, untrack } from 'svelte';
	import { MediaQuery, SvelteSet } from 'svelte/reactivity';
	import { invalidateAll } from '$app/navigation';
	import ViewSentence from '$lib/ViewSentence.svelte';
	import { habitsWords } from '$lib/view-words';
	import EditableList from '$lib/ui/EditableList.svelte';
	import AreaGroups from '$lib/ui/AreaGroups.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';
	import StatusTag from '$lib/ui/StatusTag.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import BulkBar from '$lib/bulk/BulkBar.svelte';
	import { moveKey, reorderFrom, type Mode, type Move } from '$lib/ui/list';
	import { isFollow, isGroup } from '$lib/engine/schedule';
	import { consistencyText } from '$lib/engine/stats';
	import { saveLayout, viewOp } from '$lib/viewclient';
	import { runAction, showToast, undoWith } from '$lib/toast.svelte';
	import { goneAt } from '$lib/undelete';
	import { groupBy, manualOrder, passes, type HabitLineKey } from '$lib/views';

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
	/** The lines on each habit, kept for the account: the sentence's last word (TS.12). */
	function setLines(lines: HabitLineKey[], said: string) {
		const before = views.habits;
		views.habits = { ...views.habits, lines };
		void saveLayout({ op: 'patch', habits: { lines } }, () => (views.habits = before), () => setLines(lines, said)).then(
			(ok) => ok && showToast(said, async () => !!(await saveLayout({ op: 'patch', habits: { lines: before.lines } }, () => {}).then((r) => r && (views.habits = before))))
		);
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
	const identitiesOn = $derived(!views.hidden.includes('identities'));
	/** The habits the side column counts: the ones not archived. */
	const live = $derived(habits.filter((h) => !h.archived));
	const wide = new MediaQuery('min-width: 64rem');
	const sideSays = $derived([data.areas.length ? 'Areas' : '', identitiesOn ? 'Identities' : '', 'Add from'].filter(Boolean).join(', '));

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
	async function moveTo(id: string, parentId: string | null, after: string, done: string, also?: { label: string; run: () => unknown }) {
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
		showToast(
			done,
			async () => {
				if (!(await runAction('/habits?/move', { id, parent: was.parentId ?? '' })).ok) return false;
				views.today = { ...views.today, order: was.order };
				viewOp({ op: 'patch', today: { order: was.order } });
				await invalidateAll();
			},
			undefined,
			also
		);
	}
	function indent(id: string, into: string) {
		const h = byId(id);
		const g = byId(into);
		const last = mine(habits.filter((x) => x.parentId === into && x.id !== id)).at(-1);
		// A habit with past days: the move counts from today on, or, asked here, from its start.
		const past = !!h && h.startDate < data.today;
		moveTo(id, into, last?.id ?? into, `Moved ${h?.name} into ${g?.name}${past ? ', from today on' : ''}.`, past ? { label: 'Past days too', run: () => pastToo(id, into) } : undefined);
	}
	/** The move counts on the habit's past days too, with an Undo back to from today on. */
	async function pastToo(id: string, into: string) {
		const r = await runAction<{ undo: string | null; groupStart: string | null }>('/habits?/move', { id, parent: into, applies: 'past' });
		if (!r.ok) return r.error ?? false;
		const undo = r.data?.undo;
		const g = byId(into);
		const start = r.data?.groupStart ? ` ${g?.name} now starts ${new Date(r.data.groupStart + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.` : '';
		showToast(`${byId(id)?.name} counts in ${g?.name} on its past days too.${start}`, undo ? () => undoTo(undo) : undefined);
	}
	const undoTo = async (token: string) => (await fetch('/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: token }) }).catch(() => null))?.ok ?? false;
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
		// Put back, for a deleted one: brought back, it isn't about to go any more.
		habits = habits.map((x) => (x.id === h.id ? { ...x, archived: to, deleteAfter: null } : x));
		const r = await runAction(to ? '/habits?/archive' : '/habits?/unarchive', { id: h.id });
		if (!r.ok) {
			habits = habits.map((x) => (x.id === h.id ? { ...x, archived: !to, deleteAfter: h.deleteAfter } : x));
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
		if (h.deleteAfter) return `Deleted. It goes for good with its logs on ${goneAt(h.deleteAfter)}.`;
		const a = area(h.areaId);
		return [
			show('schedule') ? (h.direction === 'break' ? 'Break habit' : h.tracker ? `Tracker · ${describeAsks(h.schedule)}` : (isGroup(h.schedule) || !h.holds || !habits.some((x) => x.parentId === h.id) ? '' : 'Routine · ') + describeSchedule(h.schedule, data.habits.find((x) => x.id === h.parentId), h.variants)) : null,
			show('cue') ? cueText(h.cue) : null,
			show('area') && a && view.group !== 'area' ? `${a.name}` : null,
			show('consistency') && h.consistency !== null ? consistencyText({ consistency: h.consistency, days: h.consistencyDays }) : null,
			show('last') && h.tracker ? (h.last ? `last ${h.last}` : 'nothing logged yet') : null,
			show('last') && h.direction !== 'break' && !h.tracker ? (h.lastDone ? `last done ${ago(h.lastDone)}` : 'not done yet') : null
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
	add={{ label: 'New habit', href: '/habits/new' }}
	more={[...(identitiesOn ? [{ label: 'Identities', href: '/identities' }] : []), { label: 'Gallery', href: '/gallery' }, { label: 'Import a template file', href: '/habits/import' }]}
/>

{#if habits.length}
	<ViewSentence
		page="habits"
		bind:views
		bind:current={view}
		{mode}
		words={habitsWords(view, { areas: data.areas, identities: identitiesOn ? identityNames : [], lines: views.habits.lines, setLines })}
	/>
	{#if !wide.current}<details class="disclosure side-fold"><summary class="meta"><span class="chev" aria-hidden="true">›</span>{sideSays}</summary><div>{@render side()}</div></details>{/if}
{/if}

<!-- The side column, beside the list from 64rem and folded under the sentence on a phone (TS.15). Pressing an Area or an
     Identity changes the view, as its word in the sentence does. -->
{#snippet side()}
	{#if data.areas.length}
		<GroupHeading title="Areas" />
		<div class="side-card side-list" role="group" aria-label="Areas">
			<button type="button" class="side-row" aria-pressed={!view.areas.length} onclick={() => (view = { ...view, areas: [] })}>Every Area<span class="num">{live.length}</span></button>
			{#each data.areas as a (a.id)}
				{@const on = view.areas.length === 1 && view.areas[0] === a.id}
				<button type="button" class="side-row" aria-pressed={on} onclick={() => (view = { ...view, areas: on ? [] : [a.id] })}>{a.name}<span class="num">{live.filter((h) => h.areaId === a.id).length}</span></button>
			{/each}
		</div>
	{/if}
	{#if identitiesOn}
		<GroupHeading title="Identities" />
		{#if identityNames.length}
			<div class="side-card side-list" role="group" aria-label="Identities">
				{#each identityNames as i (i)}
					<button type="button" class="side-row" aria-pressed={view.identity === i} onclick={() => (view = { ...view, identity: view.identity === i ? null : i })}>{i}<span class="num">{live.filter((h) => h.identities.includes(i)).length}</span></button>
				{/each}
			</div>
		{/if}
		<div class="side-foot"><a class="quiet" href="/identities">{identityNames.length ? 'Open Identities' : 'Say who you want to be'}</a></div>
	{/if}
	<GroupHeading title="Add from" />
	<div class="side-foot"><a class="button" href="/gallery">Gallery</a><a class="button" href="/habits/import">A file</a></div>
{/snippet}

<div class="page-cols">
	<div class="page-main">
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
					<button class="quiet" onclick={() => switchView(sv.id, sv.name)}>Switch to {sv.name}</button>
					<button class="quiet" onclick={() => (viewDismissed = true)}>No thanks</button>
				</div>
			</div>
		{/if}

		{#if habits.length === 0}
			<EmptyState text="A habit can be something to build, like a gym plan or language practice, or something to break, like smoking. Pick a ready-made one from the Gallery or make your own." />
		{:else if !shown.length}
			<EmptyState kind="filtered" text="No habits match these filters." />
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
	</div>
	{#if wide.current}<aside class="page-side" aria-label="Around your habits">{@render side()}</aside>{/if}
</div>

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
		removeLabel={(h) => (h.deleteAfter ? 'Put back' : h.archived ? 'Unarchive' : 'Archive')}
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

<style>
	.added {
		border-color: var(--accent);
		margin-bottom: 0.75rem;
	}
</style>
