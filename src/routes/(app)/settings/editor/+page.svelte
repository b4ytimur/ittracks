<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head><title>New habits and units · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>New habits and units</h1>
	<a href="/settings">‹ Settings</a>
</header>

<form method="POST" action="?/save" class="card stack" use:enhance={() => async ({ update }) => update({ reset: false })}>
	<h2 style="margin: 0">Habit editor</h2>
	<label style="color: var(--text)"
		><input type="checkbox" name="guidedSetup" checked={data.guidedSetup} /> New habits ask how to start (gallery, step by step, copy, or blank)</label
	>
	<label style="color: var(--text)"
		><input type="checkbox" name="showAllSections" checked={data.showAllSections} /> Show every section in the habit editor</label
	>
	<h2 style="margin: 0">Units</h2>
	<label
		>Default weight unit for new Tasks
		<input name="weightUnit" value={data.weightUnit} list="weight-units" required />
	</label>
	<datalist id="weight-units"><option value="kg"></option><option value="lb"></option></datalist>
	<p class="muted small-text" style="margin: 0">Each Metric keeps its own unit; you can change it in the Task editor.</p>
	<button class="primary">Save</button>
	{#if form?.error}<p class="error">{form.error}</p>{/if}
	{#if form?.saved}<p class="muted">Saved.</p>{/if}
</form>

<style>
	.small-text {
		font-size: 0.85rem;
	}
</style>
