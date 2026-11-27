<script lang="ts">
	import { page } from '$app/state';
	import { onDestroy, untrack } from 'svelte';
	import { MediaQuery, SvelteSet } from 'svelte/reactivity';
	import ViewSentence from '$lib/ViewSentence.svelte';
	import { libraryWords } from '$lib/view-words';
	import EditableList from '$lib/ui/EditableList.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';
	import StatusTag from '$lib/ui/StatusTag.svelte';
	import type { Mode } from '$lib/ui/list';
	import AreaGroups from '$lib/ui/AreaGroups.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import { invalidateAll } from '$app/navigation';
	import { runAction, showToast, undoWith } from '$lib/toast.svelte';
	import { goneAt } from '$lib/undelete';
	import BulkBar from '$lib/bulk/BulkBar.svelte';
	import { unitOptions } from '$lib/bulk/catalog';
	import { units } from '$lib/units-here';
	import { groups as tagGroups } from '$lib/groupings-here';
	import { groupBy } from '$lib/views';

	let { data } = $props();

	type Task = (typeof data.tasks)[number];
	/** The list as shown, changed at once by edits here and refreshed from the server after. */
	let tasks = $derived(data.tasks);
	/** One of three on this same list. Editing renames in place and archives; the Library has no order of its own to drag. */
	let mode = $state<Mode>('use');
	/** Archived while editing: they stay in the list, struck, until editing ends. */
	const struck = new SvelteSet<string>();

	// Search, filters and sort are a view: remembered between visits and savable by name.
	let views = $state(untrack(() => data.views));
	let view = $state(
		untrack(() => {
			const v = data.initial;
			const c = page.url.searchParams.get('collection');
			return c ? { ...v, collection: c } : v;
		})
	);
	const areaId = $derived(view.areas[0] ?? null);
	const setArea = (id: string | null) => (view.areas = id ? [id] : []);

	const toggleTag = (t: string) => (view.tags = view.tags.includes(t) ? view.tags.filter((x) => x !== t) : [...view.tags, t]);

	const shown = $derived.by(() => {
		const inCollection = view.collection ? new Set(data.collections.find((c) => c.id === view.collection)?.taskIds ?? []) : null;
		const q = view.query.trim().toLowerCase();
		const list = tasks.filter(
			(t) =>
				(data.showArchived || !t.archived || struck.has(t.id)) &&
				(!q || t.name.toLowerCase().includes(q) || t.tags.some((g) => g.name.toLowerCase().includes(q))) &&
				view.tags.every((g) => t.tags.some((x) => x.name === g)) &&
				(!areaId || t.areaId === areaId) &&
				(!inCollection || inCollection.has(t.id))
		);
		const by = {
			name: (a: (typeof list)[number], b: (typeof list)[number]) => a.name.localeCompare(b.name),
			recent: (a: (typeof list)[number], b: (typeof list)[number]) => b.createdAt - a.createdAt,
			used: (a: (typeof list)[number], b: (typeof list)[number]) => b.timesLogged - a.timesLogged || a.name.localeCompare(b.name),
			logged: (a: (typeof list)[number], b: (typeof list)[number]) =>
				(b.lastLogged ?? '').localeCompare(a.lastLogged ?? '') || a.name.localeCompare(b.name)
		}[view.sort as 'name' | 'recent' | 'used' | 'logged'] ?? ((a: (typeof list)[number], b: (typeof list)[number]) => a.name.localeCompare(b.name));
		return [...list].sort(by);
	});

	const groups = $derived(groupBy(shown, areaId ? 'none' : view.group, { areas: data.areas }, { keepEmpty: mode === 'edit' }));

	const topCollections = $derived(data.collections.filter((c) => !c.parentId));
	const childrenOf = (id: string) => data.collections.filter((c) => c.parentId === id);
	const area = (id: string | null) => data.areas.find((a) => a.id === id);
	const filtering = $derived(!!(view.query || view.tags.length || areaId || view.collection));
	const clear = () => (view = { ...view, query: '', tags: [], areas: [], collection: null });
	/** The Tasks the side column counts: the ones not archived. */
	const live = $derived(tasks.filter((t) => !t.archived));
	const wide = new MediaQuery('min-width: 64rem');
	const sideSays = $derived([data.areas.length ? 'Areas' : '', 'Collections', data.tags.length ? 'Tags' : ''].filter(Boolean).join(', '));

	/** Select mode: tick Tasks, then change them together from the band. */
	let outcome = $state(new Map<string, { tag?: string; reason?: string }>());
	const selected = new SvelteSet<string>();
	/** The ticked Tasks and the Library Tasks inside them, at any depth. */
	function withInside(ids: string[]) {
		const out = new Set(ids);
		for (const id of out) for (const p of data.inside) if (p.taskId === id) out.add(p.childTaskId);
		return out;
	}
	/** The number fields in the ticked Tasks and the Tasks inside them, by name: what "Change a unit" can pick. */
	function fieldsIn(ids: string[]) {
		const picked = withInside(ids);
		const byName = new Map<string, { name: string; tasks: Set<string>; units: Set<string> }>();
		for (const f of data.numberFields) {
			if (!picked.has(f.taskId)) continue;
			const k = f.name.trim().toLowerCase();
			const g = byName.get(k) ?? byName.set(k, { name: f.name.trim(), tasks: new Set(), units: new Set() }).get(k)!;
			g.tasks.add(f.taskId);
			g.units.add(f.unit || 'no unit');
		}
		return [...byName.values()]
			// Fields with a unit first: those are the ones a unit change is for.
			.sort((a, b) => Number(a.units.has('no unit')) - Number(b.units.has('no unit')) || b.tasks.size - a.tasks.size || a.name.localeCompare(b.name))
			.map((g) => ({ value: g.name, label: `${g.name} · ${g.tasks.size} ${g.tasks.size === 1 ? 'Task' : 'Tasks'} · ${[...g.units].join(', ')}` }));
	}
	const sources = (ids: string[]) => ({ fields: fieldsIn(ids), units: unitOptions(units().names()) });

	const patch = (id: string, change: Partial<Task>) => (tasks = tasks.map((x) => (x.id === id ? { ...x, ...change } : x)));
	async function rename(t: Task, name: string) {
		const before = t.name;
		patch(t.id, { name });
		const r = await runAction('/library?/rename', { id: t.id, name });
		if (!r.ok) {
			patch(t.id, { name: before });
			return showToast(r.error ?? "Couldn't rename it. Are you online?");
		}
		showToast(`Renamed to “${name}”.`, undoWith('/library?/rename', { id: t.id, name: before }));
	}
	async function archive(t: Task) {
		const to = !t.archived;
		const { deleteAfter } = t;
		// Put back, for a deleted one: brought back, it isn't about to go any more.
		patch(t.id, { archived: to, deleteAfter: null });
		const r = await runAction(to ? '/library?/archive' : '/library?/unarchive', { id: t.id });
		if (!r.ok) {
			patch(t.id, { archived: !to, deleteAfter });
			return showToast(r.error ?? "Couldn't change it. Are you online?");
		}
		// The row shows its own way back until editing ends.
		if (to) struck.add(t.id);
		else if (!struck.delete(t.id)) showToast(`${t.name} is back.`, undoWith('/library?/archive', { id: t.id }));
	}
	/** Editing ended: the struck rows go, and the band can bring them back. */
	function leave() {
		const gone = tasks.filter((t) => struck.has(t.id));
		struck.clear();
		if (!gone.length) return;
		if (navigator.onLine) invalidateAll();
		showToast(`Archived ${gone.length === 1 ? gone[0].name : `${gone.length} Tasks`}. ${gone.length === 1 ? 'Its' : 'Their'} logs are kept.`, async () => {
			let ok = true;
			for (const t of gone) ok = (await runAction('/library?/unarchive', { id: t.id })).ok && ok;
			return ok;
		});
	}
	// Leaving the page ends editing too.
	onDestroy(leave);
	const setMode = (m: Mode) => {
		if (mode === 'edit' && m !== 'edit') leave();
		mode = m;
	};
	const metaOf = (t: Task) =>
		t.deleteAfter
			? `Deleted. It goes for good with its logs on ${goneAt(t.deleteAfter)}.`
			: [view.group === 'area' || areaId ? '' : area(t.areaId)?.name, t.usedIn.length ? `In ${t.usedIn.join(', ')}` : ''].filter(Boolean).join(' · ');
</script>

<svelte:head><title>Library · ittracks</title></svelte:head>

<EditChrome
	title="Library"
	{mode}
	modes={['use', 'edit', 'select']}
	onmode={setMode}
	hints={{
		use: `${shown.length} ${shown.length === 1 ? 'Task' : 'Tasks'}`,
		edit: 'Tap a name to rename it. Archived Tasks keep their logs.',
		select: 'Tick Tasks to change them together.'
	}}
	add={{ label: 'New task', href: `/library/new${areaId ? `?area=${areaId}` : view.collection ? `?collection=${view.collection}` : ''}` }}
	more={[
		{ label: data.showArchived ? 'Hide archived' : 'Show archived', href: data.showArchived ? '/library' : '/library?archived' },
		...(view.collection ? [{ label: 'Edit this collection', href: `/library/collections/${view.collection}` }] : []),
		{ label: 'New collection', href: '/library/collections/new' }
	]}
/>

<div class="search page-wide" role="search">
	<label class="vh" for="li-q">Search Tasks and tags</label>
	<input id="li-q" type="search" bind:value={view.query} placeholder="Search Tasks and tags" autocomplete="off" />
	{#if view.query}<button type="button" class="quiet glyph search-clear focus-inset" aria-label="Clear search" onclick={() => ((view.query = ''), document.getElementById('li-q')?.focus())}>×</button>{/if}
</div>

<ViewSentence page="library" bind:views bind:current={view} {mode} words={libraryWords(view, { areas: data.areas.length > 0 })} />
{#if !wide.current}<details class="disclosure side-fold"><summary class="meta"><span class="chev" aria-hidden="true">›</span>{sideSays}</summary><div>{@render side()}</div></details>{/if}

<!-- The side column, beside the list from 64rem and folded under the sentence on a phone (TS.15). -->
{#snippet side()}
	{#if data.areas.length}
		<GroupHeading title="Areas" />
		<div class="side-card side-list" role="group" aria-label="Areas">
			<button type="button" class="side-row" aria-pressed={!areaId} onclick={() => setArea(null)}>Every Area<span class="num">{live.length}</span></button>
			{#each data.areas as a (a.id)}
				<button type="button" class="side-row" aria-pressed={areaId === a.id} onclick={() => setArea(areaId === a.id ? null : a.id)}>{a.name}<span class="num">{live.filter((t) => t.areaId === a.id).length}</span></button>
			{/each}
		</div>
	{/if}
	<GroupHeading title="Collections" />
	{#if data.collections.length}
		<div class="side-card side-list" role="group" aria-label="Collections">
			<button type="button" class="side-row" aria-pressed={!view.collection} onclick={() => (view.collection = null)}>Every Task<span class="num">{live.length}</span></button>
			{#each topCollections as c (c.id)}
				<button type="button" class="side-row" aria-pressed={view.collection === c.id} onclick={() => (view.collection = view.collection === c.id ? null : c.id)}>{c.name}<span class="num">{c.taskIds.length}</span></button>
				{#each childrenOf(c.id) as k (k.id)}
					<button type="button" class="side-row" aria-pressed={view.collection === k.id} onclick={() => (view.collection = view.collection === k.id ? null : k.id)}>{c.name} › {k.name}<span class="num">{k.taskIds.length}</span></button>
				{/each}
			{/each}
		</div>
	{/if}
	<div class="side-foot">
		{#if view.collection}<a class="quiet" href="/library/collections/{view.collection}">Edit collection</a>{/if}
		<a class="quiet" href="/library/collections/new">+ Collection</a>
	</div>
	{#if data.tags.length}
		<GroupHeading title="Tags" />
		<div class="chips" role="group" aria-label="Filter by tags (all must match)">
			{#each data.tags as t (t)}
				<button type="button" class="toggle" aria-pressed={view.tags.includes(t)} onclick={() => toggleTag(t)}>{t}</button>
			{/each}
		</div>
	{/if}
{/snippet}

<div class="page-cols">
	<div class="page-main">
		{#if data.tasks.length === 0}
			<EmptyState text={'Your Library holds the Tasks you build habits from, like “Bench press” or “Learn new words”. Add your first one, or add a ready-made habit and its Tasks come with it.'} />
			<a href="/gallery">Browse ready-made habits</a>
		{:else if shown.length === 0}
			<EmptyState kind="filtered" text="Nothing matches." onclear={filtering ? clear : undefined} />
		{/if}

		{#if mode === 'select'}
			<BulkBar kind="task" {selected} bind:outcome visible={shown.map((t) => t.id)} today={data.today} {sources} />
		{/if}

		<AreaGroups {groups} areas={data.areas} {mode} byArea={view.group === 'area' && !areaId}>
			{#snippet group(g)}
			<EditableList
				items={g.items}
				key={(t) => t.id}
				label={(t) => t.name}
				selecting={mode === 'select'}
				{selected}
				rowCard
				slotOpen={mode === 'edit'}
				href={mode === 'use' ? (t) => `/library/${t.id}` : undefined}
				itemClass={(t) => (struck.has(t.id) ? 'struck' : '')}
				onremove={mode === 'edit' ? archive : undefined}
				removeLabel={(t) => (t.deleteAfter ? 'Put back' : t.archived ? 'Unarchive' : 'Archive')}
				ariaLabel={g.label || 'Tasks'}
			>
				{#snippet row(t)}
					{@const o = outcome.get(t.id)}
					{#if mode === 'use'}<a class="name" href="/library/{t.id}">{t.name}</a>
					{:else}<span class="name"><InlineText value={t.name} editing={mode === 'edit' && !struck.has(t.id)} label="Name of {t.name}" maxlength={120} onsave={(v) => rename(t, v)} /></span>{/if}
					{#if o?.tag}<span class="tags"><span class="tag pending"><span aria-hidden="true">→</span> {o.tag}</span></span>
					{:else if t.archived}<span class="tags"><StatusTag status="archived" /></span>
					{:else if !t.usedIn.length && !t.timesLogged}<span class="tags"><StatusTag status="unused" /></span>{/if}
					{#if o?.reason || metaOf(t)}<p class="meta-line label">{o?.reason ?? metaOf(t)}</p>{/if}
					{#if t.tags.length}
						<span class="row-line tags">{#each t.tags as tg (tg.name)}<span class="tag">{tg.name}: {tagGroups().levelName(tg.name, tg.level)}</span>{/each}</span>
					{/if}
				{/snippet}
			</EditableList>
			{/snippet}
		</AreaGroups>
	</div>
	{#if wide.current}<aside class="page-side" aria-label="Around your Library">{@render side()}</aside>{/if}
</div>
