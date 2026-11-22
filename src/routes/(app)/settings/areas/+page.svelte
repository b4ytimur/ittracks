<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import EditableList from '$lib/ui/EditableList.svelte';

	let { data, form } = $props();

	type Row = { key: string; id: string | null; name: string; color: string; icon: string };
	let n = 0;
	/** Each row has a key of its own, so a new Area (no id yet) can be dragged like the rest. */
	const rowsOf = (list: typeof data.areas): Row[] => list.map((a) => ({ ...a, key: a.id ?? `new-${n++}` }));
	let areas = $state<Row[]>(untrack(() => rowsOf(data.areas)));
	const reorder = (order: string[]) => (areas = order.map((k) => areas.find((a) => a.key === k)!));
</script>

<svelte:head><title>Areas · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Areas</h1>
	<a href="/settings">‹ Settings</a>
</header>

<section class="card stack">
	<p class="muted small-text" style="margin: 0">Big groups for habits and Tasks. Deleting one never deletes what's in it.</p>
	<EditableList
		items={areas}
		key={(a) => a.key}
		label={(a) => a.name || 'new Area'}
		editing
		ariaLabel="Areas"
		onmove={(_, order) => reorder(order)}
		onremove={(a) => (areas = areas.filter((x) => x.key !== a.key))}
		removeLabel="Delete"
		onadd={() => areas.push({ key: `new-${n++}`, id: null, name: '', color: data.colors[areas.length % data.colors.length], icon: '' })}
		addLabel="Area"
	>
		{#snippet row(a)}
			<div class="row area-row">
				<input style="width: 3.2rem; text-align: center" bind:value={a.icon} aria-label="Icon" maxlength="8" />
				<input class="grow" bind:value={a.name} aria-label="Name" />
				<select bind:value={a.color} aria-label="Color" style="width: 6.5rem; color: {a.color}">
					{#each data.colors as c (c)}<option value={c} style="color: {c}">● {c}</option>{/each}
				</select>
			</div>
		{/snippet}
		{#snippet empty()}<p class="muted" style="margin: 0">No Areas yet.</p>{/snippet}
	</EditableList>
	<form method="POST" action="?/areas" class="row" use:enhance={() => async ({ update, result }) => {
			await update({ reset: false });
			// New Areas got their ids: take them, so saving again keeps the same Areas.
			if (result.type === 'success') areas = rowsOf(data.areas);
		}}>
		<input type="hidden" name="areas" value={JSON.stringify(areas.map(({ key: _, ...a }) => a))} />
		<button class="primary">Save Areas</button>
	</form>
	{#if form?.areasError}<p class="error">{form.areasError}</p>{/if}
	{#if form?.areasSaved}<p class="muted">Saved.</p>{/if}
</section>

<style>
	.small-text {
		font-size: 0.85rem;
	}
	.area-row {
		align-items: center;
	}
</style>
