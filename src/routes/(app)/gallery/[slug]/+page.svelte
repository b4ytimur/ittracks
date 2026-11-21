<script lang="ts">
	import TemplatePreview from '$lib/TemplatePreview.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>{data.template.name} · Gallery · ittracks</title></svelte:head>

<header class="bar">
	<h1>{data.template.name}</h1>
	<a href="/gallery">Gallery</a>
</header>

<form method="POST" action="?/add" class="stack">
	<TemplatePreview tpl={data.template} today={data.today} libraryNames={data.libraryNames} habitNames={data.habitNames} areaNames={data.areaNames} />
	{#if form?.error}<p class="error">{form.error}</p>{/if}
	<button class="primary">Add this habit</button>
	<p class="muted small-text">You can change the schedule, Tasks and targets afterwards in the habit editor.</p>
</form>

<style>
	.small-text {
		font-size: 0.85rem;
	}
</style>
