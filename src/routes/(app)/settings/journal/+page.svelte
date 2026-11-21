<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head><title>Journal · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Journal</h1>
	<a href="/settings">‹ Settings</a>
</header>

{#if data.off}
	<p class="card muted small-text">The Journal feature is switched off, so the Journal page and the day note are hidden. <a href="/settings/features">Switch it on</a>.</p>
{/if}

<form method="POST" action="?/save" class="card stack" use:enhance={() => async ({ update }) => update({ reset: false })}>
	<p class="muted small-text" style="margin: 0">
		The journal is a habit like any other (add one from the <a href="/journal?setup">Journal</a> page or the gallery), and the
		<a href="/journal">Journal page</a> shows everything you wrote, by day. Notes and journal entries are private: they never go into templates or
		anything you share.
	</p>
	<label style="color: var(--text)"
		><input type="checkbox" name="dayNote" checked={data.dayNote} /> A day note on Today: one free note per day, no streak</label
	>
	<button>Save</button>
	{#each form?.warnings ?? [] as w (w)}<p class="muted small-text" style="margin: 0">{w}.</p>{/each}
	{#if form?.saved}<p class="muted" style="margin: 0">Saved.</p>{/if}
</form>

<section class="card stack">
	<h2 style="margin: 0">Export for Obsidian</h2>
	<p class="muted small-text" style="margin: 0">
		Downloads everything you wrote as Markdown, one file per day (like 2026-11-21.md, the way Obsidian names daily notes), with your
		mood and the habits you did at the top. Unzip it into your vault.
	</p>
	<div><a class="button" href="/journal/export" download>Download the journal</a></div>
</section>

<style>
	.small-text {
		font-size: 0.85rem;
	}
</style>
