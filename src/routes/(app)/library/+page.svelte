<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import ViewBar from '$lib/ViewBar.svelte';
	import EditableList from '$lib/ui/EditableList.svelte';
	import EditButton from '$lib/ui/EditButton.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import { invalidateAll } from '$app/navigation';
	import { runAction, showToast } from '$lib/toast.svelte';
	import BulkBar from '$lib/bulk/BulkBar.svelte';
	import { unitOptions } from '$lib/bulk/catalog';
	import { groupBy } from '$lib/views';

	let { data } = $props();

	type Task = (typeof data.tasks)[number];
	/** The list as shown, changed at once by edits here and refreshed from the server after. */
	let tasks = $derived(data.tasks);
	/** Edit mode is a flag on this same list: rename in place and archive. The Library has no order of its own to drag. */
	let editing = $state(false);

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
	let showTags = $state(false);

	const levelWord = ['', 'low', 'medium', 'high'];
	const toggleTag = (t: string) => (view.tags = view.tags.includes(t) ? view.tags.filter((x) => x !== t) : [...view.tags, t]);

	const shown = $derived.by(() => {
		const inCollection = view.collection ? new Set(data.collections.find((c) => c.id === view.collection)?.taskIds ?? []) : null;
		const q = view.query.trim().toLowerCase();
		const list = tasks.filter(
			(t) =>
				(data.showArchived || !t.archived) &&
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

	const groups = $derived(groupBy(shown, areaId ? 'none' : view.group, { areas: data.areas }));

	const topCollections = $derived(data.collections.filter((c) => !c.parentId));
	const childrenOf = (id: string) => data.collections.filter((c) => c.parentId === id);
	const area = (id: string | null) => data.areas.find((a) => a.id === id);
	const filtering = $derived(!!(view.query || view.tags.length || areaId || view.collection));
	const clear = () => (view = { ...view, query: '', tags: [], areas: [], collection: null });

	/** Selecting is a flag on the same list: tick Tasks, then change them together from the bulk bar. */
	let selecting = $state(false);
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
	const sources = (ids: string[]) => ({ fields: fieldsIn(ids), units: unitOptions() });

	const patch = (id: string, change: Partial<Task>) => (tasks = tasks.map((x) => (x.id === id ? { ...x, ...change } : x)));
	async function rename(t: Task, name: string) {
		const before = t.name;
		patch(t.id, { name });
		const r = await runAction('?/rename', { id: t.id, name });
		if (!r.ok) {
			patch(t.id, { name: before });
			return showToast(r.error ?? "Couldn't rename it. Are you online?");
		}
		showToast(`Renamed to “${name}”.`, async () => {
			await runAction('?/rename', { id: t.id, name: before });
			await invalidateAll();
		});
	}
	async function archive(t: Task) {
		const to = !t.archived;
		patch(t.id, { archived: to });
		const r = await runAction(to ? '?/archive' : '?/unarchive', { id: t.id });
		if (!r.ok) {
			patch(t.id, { archived: !to });
			return showToast(r.error ?? "Couldn't change it. Are you online?");
		}
		showToast(to ? `Archived ${t.name}. Its logs are kept.` : `${t.name} is back.`, async () => {
			await runAction(to ? '?/unarchive' : '?/archive', { id: t.id });
			await invalidateAll();
		});
	}
</script>

<svelte:head><title>Library · ittracks</title></svelte:head>

<header class="bar">
	<h1>Library</h1>
	<a class="button primary" href="/library/new{areaId ? `?area=${areaId}` : view.collection ? `?collection=${view.collection}` : ''}">New task</a>
</header>

<ViewBar page="library" bind:views bind:current={view}>
	{#snippet end()}
		<EditButton bind:editing look="chip" onchange={(on) => on && (selecting = false)} />
		<EditButton bind:editing={selecting} label="Select" look="chip" onchange={(on) => on && (editing = false)} />
	{/snippet}
</ViewBar>

<input type="search" bind:value={view.query} placeholder="Search Tasks and tags" aria-label="Search" />

<div class="chips" role="group" aria-label="Area">
	<button class="chip small" class:on={!areaId} onclick={() => setArea(null)}>All areas</button>
	{#each data.areas as a (a.id)}
		<button class="chip small" class:on={areaId === a.id} style="--c: {a.color}" onclick={() => setArea(areaId === a.id ? null : a.id)}>{a.icon} {a.name}</button>
	{/each}
</div>

<div class="chips" role="group" aria-label="Collections">
	{#each topCollections as c (c.id)}
		<button class="chip small" class:on={view.collection === c.id} onclick={() => (view.collection = view.collection === c.id ? null : c.id)}
			>{c.smart ? '⚡ ' : ''}{c.name} · {c.taskIds.length}</button
		>
		{#each childrenOf(c.id) as k (k.id)}
			<button class="chip small sub" class:on={view.collection === k.id} onclick={() => (view.collection = view.collection === k.id ? null : k.id)}
				>{c.name} › {k.smart ? '⚡ ' : ''}{k.name} · {k.taskIds.length}</button
			>
		{/each}
	{/each}
	{#if view.collection}<a class="chip small" href="/library/collections/{view.collection}">Edit collection</a>{/if}
	<a class="chip small" href="/library/collections/new">+ Collection</a>
</div>

<div class="row tools">
	<span class="grow"></span>
	{#if data.tags.length}
		<button type="button" class="small" onclick={() => (showTags = !showTags)}>Tags{view.tags.length ? ` (${view.tags.length})` : ''}</button>
	{/if}
	<a class="small-text" href={data.showArchived ? '/library' : '/library?archived'}>{data.showArchived ? 'Hide archived' : 'Show archived'}</a>
</div>
{#if showTags}
	<div class="chips" role="group" aria-label="Filter by tags (all must match)">
		{#each data.tags as t (t)}
			<button class="chip small" class:on={view.tags.includes(t)} onclick={() => toggleTag(t)}>{t}</button>
		{/each}
	</div>
{/if}

{#if data.tasks.length === 0}
	<p class="muted">
		Your Library holds the Tasks you build habits from, like "Bench press" or "Learn new words".
		Add your first one, or <a href="/gallery">add a ready-made habit</a> and its Tasks come with it.
	</p>
{:else if shown.length === 0}
	<p class="muted">Nothing matches. {#if filtering}<button class="link" onclick={clear}>Clear filters</button>{/if}</p>
{/if}

{#if editing}
	<p class="muted small-text">Tap a name to rename it. Archived Tasks keep their logs and leave the pickers.</p>
{/if}
{#if selecting}
	<BulkBar kind="task" {selected} visible={shown.map((t) => t.id)} today={data.today} {sources} />
{/if}

{#each groups as g (g.key)}
	{#if g.label}
		<h2 class="area" style="--c: {g.color ?? 'var(--border)'}">{g.label}</h2>
	{/if}
	<EditableList
		items={g.items}
		key={(t) => t.id}
		label={(t) => t.name}
		{editing}
		{selecting}
		{selected}
		onremove={archive}
		removeLabel={(t) => (t.archived ? 'Unarchive' : 'Archive')}
		ariaLabel={g.label || 'Tasks'}
		class="tasks"
	>
		{#snippet row(t)}
			{@const a = area(t.areaId)}
			<svelte:element this={editing ? 'div' : 'a'} class="card task" href={editing ? undefined : `/library/${t.id}`} style="--c: {a?.color ?? 'transparent'}">
				<div class="row" style="align-items: center">
					<strong class="grow"><InlineText value={t.name} {editing} label="Name of {t.name}" maxlength={120} onsave={(v) => rename(t, v)} /></strong>
					{#if t.archived}<span class="chip">Archived</span>{:else if !t.usedIn.length && !t.timesLogged}<span class="chip">Unused</span>{/if}
				</div>
				{#if t.usedIn.length}<div class="muted small-text">In {t.usedIn.join(', ')}</div>{/if}
				{#if t.tags.length}
					<div class="chips">
						{#each t.tags as tg (tg.name)}<span class="chip">{tg.name}: {levelWord[tg.level]}</span>{/each}
					</div>
				{/if}
			</svelte:element>
		{/snippet}
	</EditableList>
{/each}

<style>
	.small-text {
		font-size: 0.85rem;
	}
	.tools {
		margin-top: 0.6rem;
		align-items: end;
	}
	.chip.small {
		background: none;
		cursor: pointer;
		text-decoration: none;
	}
	.chip.sub {
		font-style: italic;
	}
	.task {
		border-left: 4px solid var(--c);
	}
	:global(ul.tasks) {
		margin-top: 0.75rem;
	}
	h2.area {
		border-left: 4px solid var(--c);
		padding-left: 0.5rem;
	}
</style>
