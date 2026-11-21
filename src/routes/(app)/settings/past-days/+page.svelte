<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { PAST_DAYS_CHOICES } from '$lib/engine/backfill';
	import { blocked } from '$lib/rules/core';
	import { settingsRules } from '$lib/rules/settings';

	let { data, form } = $props();

	let pastDays = $state(untrack(() => (data.settings.pastDays === null ? '' : String(data.settings.pastDays))));
	/** Greyed out while past-day logging is off: the rule lives in rules/settings.ts. */
	const nudgeBlocked = $derived(
		blocked(settingsRules, { ...data.settings, pastDays: pastDays === '' ? null : Number(pastDays) }, 'nudgeYesterday', {
			usedRanges: []
		})
	);
</script>

<svelte:head><title>Past days · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Past days</h1>
	<a href="/settings">‹ Settings</a>
</header>

<form method="POST" action="?/pastDays" class="card stack" use:enhance={() => async ({ update }) => update({ reset: false })}>
	<p class="muted small-text" style="margin: 0">
		Log a day you forgot from Today, History or a habit's chain. A late log counts like one made on the day, streaks included.
	</p>
	<label
		>How far back you can log
		<select name="pastDays" bind:value={pastDays}>
			{#each PAST_DAYS_CHOICES as c (c.label)}<option value={c.value === null ? '' : String(c.value)}>{c.label}</option>{/each}
		</select>
	</label>
	<p class="muted small-text" style="margin: 0">A shorter limit keeps streaks honest. Slips can always be added for a past day.</p>
	<label style="color: var(--text)"
		><input type="checkbox" name="nudgeYesterday" checked={data.settings.nudgeYesterday} disabled={!!nudgeBlocked} />
		Tell me on Today when yesterday has habits left unlogged{nudgeBlocked ? ` (${nudgeBlocked.reason.toLowerCase()})` : ''}</label
	>
	<button>Save</button>
	{#if form?.pastError}<p class="error">{form.pastError}</p>{/if}
	{#if form?.pastSaved}<p class="muted">Saved.</p>{/if}
</form>

<style>
	.small-text {
		font-size: 0.85rem;
	}
</style>
