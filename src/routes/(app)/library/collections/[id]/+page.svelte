<script lang="ts">
	import { untrack } from 'svelte';

	let { data, form } = $props();

	const c0 = untrack(() => data.collection);
	let name = $state(c0.name);
	let parentId = $state<string | null>(c0.parentId);
	let smart = $state(!!c0.filter);
	let filterTags = $state<string[]>(c0.filter?.tags ?? []);
	let filterArea = $state<string | null>(c0.filter?.areaId ?? null);
	let filterText = $state(c0.filter?.text ?? '');
	let picked = $state<string[]>([...c0.taskIds]);
	let search = $state('');

	const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

	/** Live preview of what a smart collection catches. */
	const preview = $derived(
		data.tasks.filter((t) => {
			if (!filterTags.length && !filterArea && !filterText.trim()) return false;
			const tags = new Set(t.tags.map((g) => g.name.toLowerCase()));
			return (
				filterTags.every((g) => tags.has(g.toLowerCase())) &&
				(!filterArea || t.areaId === filterArea) &&
				(!filterText.trim() || t.name.toLowerCase().includes(filterText.trim().toLowerCase()))
			);
		})
	);
	const listed = $derived(data.tasks.filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase())));

	const payload = $derived(
		JSON.stringify({ name, parentId, smart, filter: { tags: filterTags, areaId: filterArea, text: filterText }, taskIds: picked })
	);
</script>

<svelte:head><title>{data.isNew ? 'New collection' : name} · ittracks</title></svelte:head>

<header class="bar">
	<h1>{data.isNew ? 'New collection' : 'Edit collection'}</h1>
	<a href="/library">Cancel</a>
</header>

<form method="POST" action="?/save" class="stack">
	<input type="hidden" name="payload" value={payload} />
	<label>Name <input bind:value={name} placeholder="Push exercises" required /></label>
	{#if !data.hasChildren && data.parents.length}
		<label
			>Inside
			<select value={parentId ?? ''} onchange={(e) => (parentId = e.currentTarget.value || null)}>
				<option value="">Nothing (top level)</option>
				{#each data.parents as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
		</label>
	{/if}

	<fieldset class="card">
		<label style="color: var(--ink)"><input type="radio" bind:group={smart} value={false} /> Hand-picked: you choose the Tasks</label>
		<label style="color: var(--ink)"><input type="radio" bind:group={smart} value={true} /> Smart: Tasks that match rules, kept up to date</label>
	</fieldset>

	{#if smart}
		<div>
			<span class="muted small-text">Has every one of these tags</span>
			<div class="chips">
				{#each data.tags as t (t)}
					<button type="button" class="toggle" aria-pressed={filterTags.includes(t)} onclick={() => (filterTags = toggle(filterTags, t))}>{t}</button>
				{/each}
				{#if !data.tags.length}<span class="muted small-text">No tags yet.</span>{/if}
			</div>
		</div>
		<label
			>In area
			<select value={filterArea ?? ''} onchange={(e) => (filterArea = e.currentTarget.value || null)}>
				<option value="">Any</option>
				{#each data.areas as a (a.id)}<option value={a.id}>{a.icon} {a.name}</option>{/each}
			</select>
		</label>
		<label>Name contains <input bind:value={filterText} placeholder="press" /></label>
		<p class="muted small-text">Matches {preview.length}: {preview.slice(0, 8).map((t) => t.name).join(', ')}{preview.length > 8 ? '…' : ''}</p>
	{:else}
		<input type="search" bind:value={search} placeholder="Find Tasks" aria-label="Find Tasks" />
		<div class="picks">
			{#each listed as t (t.id)}
				<label style="color: var(--ink)"><input type="checkbox" checked={picked.includes(t.id)} onchange={() => (picked = toggle(picked, t.id))} /> {t.name}</label>
			{/each}
		</div>
		<p class="muted small-text">{picked.length} picked</p>
	{/if}

	{#if form?.error}<p class="error">{form.error}</p>{/if}
	<div class="actions-bar l-stack">
		<div class="l-cluster">
			<button class="primary">Save collection</button>
			{#if !data.isNew}
				<button class="danger" formaction="?/delete" formnovalidate>Delete collection</button>
			{/if}
		</div>
	</div>
	{#if !data.isNew}<p class="muted small-text">Deleting a collection never deletes its Tasks.</p>{/if}
</form>

<style>
	fieldset {
		border: 1px solid var(--line);
	}
	.picks {
		max-height: 50vh;
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.5rem;
	}
	.picks label + label {
		margin-top: 0.35rem;
	}
</style>
