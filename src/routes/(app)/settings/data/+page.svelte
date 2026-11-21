<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>Templates and shortcuts · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Templates and shortcuts</h1>
	<a href="/settings">‹ Settings</a>
</header>

<section class="card stack">
	<h2 style="margin: 0">Export a habit</h2>
	<p class="muted small-text" style="margin: 0">
		Saves a habit and its Tasks as a template file you can share or import elsewhere, with its Areas and the Tasks its
		auto-filled slots pick from. Share… adds a description and questions for the person adding it. Your logs stay here.
	</p>
	{#if data.habits.length}
		<ul class="list">
			{#each data.habits as h (h.id)}
				<li class="row" style="align-items: center">
					<span class="grow">{h.name}</span>
					<a class="button export" href="/habits/{h.id}/template.json" download>Export</a>
					<a class="button export" href="/habits/{h.id}/share">Share…</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted" style="margin: 0">No habits yet.</p>
	{/if}
</section>

<section class="card stack">
	<h2 style="margin: 0">Import or browse</h2>
	<p class="muted small-text" style="margin: 0">
		<a href="/habits/import">Import a template file</a> (you see what it adds and answer its questions first), or pick a
		ready-made one from the <a href="/gallery">gallery</a>.
	</p>
</section>

<section class="card stack">
	<h2 style="margin: 0">Shortcuts</h2>
	<p class="muted small-text" style="margin: 0">
		Every habit has a quick-log link: <code>/q/&lt;habit&gt;</code> opens today's quick log, and <code>/q/&lt;habit&gt;?go=1</code>
		logs "Same as last time" at once. Use them from a bookmark, iOS Shortcuts or an Android launcher. Habits marked
		"Add to home screen shortcuts" show up when you long-press the installed app's icon (reinstall the app to refresh them).
	</p>
</section>

<style>
	.small-text {
		font-size: 0.85rem;
	}
	.export {
		padding: 0.25rem 0.6rem;
		font-size: 0.85rem;
	}
</style>
