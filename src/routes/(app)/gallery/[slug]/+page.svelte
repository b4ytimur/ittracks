<script lang="ts">
	import TemplatePreview from '$lib/TemplatePreview.svelte';

	let { data, form } = $props();
	const inside = $derived(data.template.children.length);
</script>

<svelte:head><title>{data.template.name} · Gallery · ittracks</title></svelte:head>

<header class="bar">
	<h1>{data.template.name}</h1>
	<a href="/gallery">Gallery</a>
</header>

{#if data.saved}<p class="card added">Saved to your Gallery. Add it from here whenever you like, or download it to send to someone.</p>{/if}

<form method="POST" action="?/add" class="stack">
	<TemplatePreview tpl={data.template} today={data.today} libraryNames={data.libraryNames} habitNames={data.habitNames} areaNames={data.areaNames} />
	{#if data.pack}<p class="muted small-text">It brings the {data.pack} pack: {data.brings} You can change or take out any of it in Settings.</p>{/if}
	{#if form?.error}<p class="error">{form.error}</p>{/if}
	<button class="primary">{inside ? `Add these ${inside + 1} habits` : 'Add this habit'}</button>
	<p class="muted small-text">You can change the schedule, Tasks and targets afterwards in the habit editor.</p>
</form>

{#if data.mine}
	<section class="row mine">
		<a href="/gallery/{data.slug}/template.json" download>Download the file</a>
		<form method="POST" action="?/delete">
			<button class="danger">Remove from my Gallery</button>
		</form>
	</section>
	<p class="muted small-text">Removing it keeps the habits you added from it.</p>
{/if}

<style>
	.small-text {
		font-size: 0.85rem;
	}
	.mine {
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		margin-top: 1rem;
	}
	.added {
		border-color: var(--accent);
	}
</style>
