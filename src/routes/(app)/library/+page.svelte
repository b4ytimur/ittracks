<script lang="ts">
	import { page } from '$app/state';

	let { data } = $props();

	let query = $state('');
	let tags = $state<string[]>([]);
	let areaId = $state<string | null>(null);
	let collectionId = $state<string | null>(page.url.searchParams.get('collection'));
	let sort = $state<'name' | 'recent' | 'used' | 'logged'>('name');
	let showTags = $state(false);

	const levelWord = ['', 'low', 'medium', 'high'];
	const toggleTag = (t: string) => (tags = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);

	const shown = $derived.by(() => {
		const inCollection = collectionId ? new Set(data.collections.find((c) => c.id === collectionId)?.taskIds ?? []) : null;
		const q = query.trim().toLowerCase();
		const list = data.tasks.filter(
			(t) =>
				(!q || t.name.toLowerCase().includes(q) || t.tags.some((g) => g.name.toLowerCase().includes(q))) &&
				tags.every((g) => t.tags.some((x) => x.name === g)) &&
				(!areaId || t.areaId === areaId) &&
				(!inCollection || inCollection.has(t.id))
		);
		const by = {
			name: (a: (typeof list)[number], b: (typeof list)[number]) => a.name.localeCompare(b.name),
			recent: (a: (typeof list)[number], b: (typeof list)[number]) => b.createdAt - a.createdAt,
			used: (a: (typeof list)[number], b: (typeof list)[number]) => b.timesLogged - a.timesLogged || a.name.localeCompare(b.name),
			logged: (a: (typeof list)[number], b: (typeof list)[number]) =>
				(b.lastLogged ?? '').localeCompare(a.lastLogged ?? '') || a.name.localeCompare(b.name)
		}[sort];
		return [...list].sort(by);
	});

	const groups = $derived.by(() => {
		if (!data.groupByArea || areaId) return [{ key: 'all', area: null as (typeof data.areas)[number] | null, items: shown }];
		const keys = [...data.areas.map((a) => a.id), ''];
		return keys
			.map((k) => ({
				key: k || 'none',
				area: data.areas.find((a) => a.id === k) ?? null,
				items: shown.filter((t) => (t.areaId && data.areas.some((a) => a.id === t.areaId) ? t.areaId : '') === k)
			}))
			.filter((g) => g.items.length);
	});

	const topCollections = $derived(data.collections.filter((c) => !c.parentId));
	const childrenOf = (id: string) => data.collections.filter((c) => c.parentId === id);
	const area = (id: string | null) => data.areas.find((a) => a.id === id);
	const filtering = $derived(!!(query || tags.length || areaId || collectionId));
</script>

<svelte:head><title>Library · ittracks</title></svelte:head>

<header class="bar">
	<h1>Library</h1>
	<a class="button primary" href="/library/new{areaId ? `?area=${areaId}` : collectionId ? `?collection=${collectionId}` : ''}">New task</a>
</header>

<input type="search" bind:value={query} placeholder="Search Tasks and tags" aria-label="Search" />

<div class="chips" role="group" aria-label="Area">
	<button class="chip small" class:on={!areaId} onclick={() => (areaId = null)}>All areas</button>
	{#each data.areas as a (a.id)}
		<button class="chip small" class:on={areaId === a.id} style="--c: {a.color}" onclick={() => (areaId = areaId === a.id ? null : a.id)}>{a.icon} {a.name}</button>
	{/each}
</div>

<div class="chips" role="group" aria-label="Collections">
	{#each topCollections as c (c.id)}
		<button class="chip small" class:on={collectionId === c.id} onclick={() => (collectionId = collectionId === c.id ? null : c.id)}
			>{c.smart ? '⚡ ' : ''}{c.name} · {c.taskIds.length}</button
		>
		{#each childrenOf(c.id) as k (k.id)}
			<button class="chip small sub" class:on={collectionId === k.id} onclick={() => (collectionId = collectionId === k.id ? null : k.id)}
				>{c.name} › {k.smart ? '⚡ ' : ''}{k.name} · {k.taskIds.length}</button
			>
		{/each}
	{/each}
	{#if collectionId}<a class="chip small" href="/library/collections/{collectionId}">Edit collection</a>{/if}
	<a class="chip small" href="/library/collections/new">+ Collection</a>
</div>

<div class="row tools">
	<label class="grow"
		>Sort
		<select bind:value={sort}>
			<option value="name">Name</option>
			<option value="recent">Newest first</option>
			<option value="used">Most logged</option>
			<option value="logged">Last logged</option>
		</select>
	</label>
	{#if data.tags.length}
		<button type="button" class="small" onclick={() => (showTags = !showTags)}>Tags{tags.length ? ` (${tags.length})` : ''}</button>
	{/if}
	<a class="small-text" href={data.showArchived ? '/library' : '/library?archived'}>{data.showArchived ? 'Hide archived' : 'Show archived'}</a>
</div>
{#if showTags}
	<div class="chips" role="group" aria-label="Filter by tags (all must match)">
		{#each data.tags as t (t)}
			<button class="chip small" class:on={tags.includes(t)} onclick={() => toggleTag(t)}>{t}</button>
		{/each}
	</div>
{/if}

{#if data.tasks.length === 0}
	<p class="muted">
		Your Library holds the Tasks you build habits from, like "Bench press" or "Learn new words".
		Add your first one, or <a href="/gallery">add a ready-made habit</a> and its Tasks come with it.
	</p>
{:else if shown.length === 0}
	<p class="muted">Nothing matches. {#if filtering}<button class="link" onclick={() => ((query = ''), (tags = []), (areaId = null), (collectionId = null))}>Clear filters</button>{/if}</p>
{/if}

{#each groups as g (g.key)}
	{#if data.groupByArea && !areaId}
		<h2 class="area" style="--c: {g.area?.color ?? 'var(--border)'}">{g.area ? `${g.area.icon} ${g.area.name}` : 'No area'}</h2>
	{/if}
	<ul class="list" style="margin-top: 0.75rem">
		{#each g.items as t (t.id)}
			{@const a = area(t.areaId)}
			<li>
				<a class="card task" href="/library/{t.id}" style="--c: {a?.color ?? 'transparent'}">
					<div class="row" style="align-items: center">
						<strong class="grow">{t.name}</strong>
						{#if t.archived}<span class="chip">Archived</span>{:else if !t.usedIn.length && !t.timesLogged}<span class="chip">Unused</span>{/if}
					</div>
					{#if t.usedIn.length}<div class="muted small-text">In {t.usedIn.join(', ')}</div>{/if}
					{#if t.tags.length}
						<div class="chips">
							{#each t.tags as tg (tg.name)}<span class="chip">{tg.name}: {levelWord[tg.level]}</span>{/each}
						</div>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
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
	h2.area {
		border-left: 4px solid var(--c);
		padding-left: 0.5rem;
	}
</style>
