<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';

	let { data, form } = $props();

	let areas = $state(untrack(() => data.areas.map((a) => ({ ...a }) as { id: string | null; name: string; color: string; icon: string })));
	function moveArea(i: number, by: number) {
		const j = i + by;
		if (j < 0 || j >= areas.length) return;
		[areas[i], areas[j]] = [areas[j], areas[i]];
	}
</script>

<svelte:head><title>Areas · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Areas</h1>
	<a href="/settings">‹ Settings</a>
</header>

<section class="card stack">
	<p class="muted small-text" style="margin: 0">Big groups for habits and Tasks. Deleting one never deletes what's in it.</p>
	{#each areas as a, i (i)}
		<div class="row area-row">
			<input style="width: 3.2rem; text-align: center" bind:value={a.icon} aria-label="Icon" maxlength="8" />
			<input class="grow" bind:value={a.name} aria-label="Name" />
			<select bind:value={a.color} aria-label="Color" style="width: 6.5rem; color: {a.color}">
				{#each data.colors as c (c)}<option value={c} style="color: {c}">● {c}</option>{/each}
			</select>
			<button type="button" class="small" onclick={() => moveArea(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
			<button type="button" class="small" onclick={() => moveArea(i, 1)} disabled={i === areas.length - 1} aria-label="Move down">↓</button>
			<button type="button" class="small danger" onclick={() => areas.splice(i, 1)} aria-label="Delete">×</button>
		</div>
	{:else}
		<p class="muted" style="margin: 0">No Areas yet.</p>
	{/each}
	<form method="POST" action="?/areas" class="row" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<input type="hidden" name="areas" value={JSON.stringify(areas)} />
		<button type="button" onclick={() => areas.push({ id: null, name: '', color: data.colors[areas.length % data.colors.length], icon: '' })}>+ Area</button>
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
