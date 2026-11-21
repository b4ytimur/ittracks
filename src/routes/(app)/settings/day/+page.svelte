<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { checkSettings, missingRanges } from '$lib/rules/settings';
	import { checkViews } from '$lib/rules/views';
	import type { DayRange } from '$lib/engine/day';

	let { data, form } = $props();

	/** `was` is the name a row had when it was loaded, so a rename can move its habits along. */
	const rows = (rs: DayRange[]) => rs.map((r) => ({ ...r, was: r.name }));

	let dayStart = $state(untrack(() => data.settings.dayStart ?? '00:00'));
	let ranges = $state(untrack(() => rows(data.settings.ranges)));

	// The same rules the server checks, shown while typing. Unnamed parts aren't saved, so they don't count.
	const named = $derived(ranges.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), start: r.start, end: r.end })));
	/** Habits follow a renamed part, so count them under the new name. */
	const used = $derived.by(() => {
		const renames = new Map(ranges.filter((r) => r.was && r.name.trim()).map((r) => [r.was, r.name.trim()]));
		return data.used.map((n) => renames.get(n) ?? n);
	});
	const ctx = $derived({ usedRanges: used });
	const issues = $derived(checkSettings({ ...data.settings, dayStart, ranges: named }, ctx));
	const blocked = $derived(issues.find((i) => i.severity === 'block')?.reason ?? null);
	const missing = $derived(
		missingRanges({ ranges: named }, ctx).map((n) => {
			const count = used.filter((u) => u === n).length;
			return `${n} (${count} ${count === 1 ? 'habit' : 'habits'})`;
		})
	);
	const warnings = $derived([
		...issues.filter((i) => i.severity === 'warn').map((i) => i.reason),
		...checkViews(data.views, { ranges: named.length })
			.filter((i) => i.path === 'today.timeAware')
			.map((i) => i.reason)
	]);
</script>

<svelte:head><title>Your day · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Your day</h1>
	<a href="/settings">‹ Settings</a>
</header>

<form
	method="POST"
	action="?/day"
	class="card stack"
	use:enhance={() =>
		async ({ result, update }) => {
			await update({ reset: false });
			// Start over from what was saved: renamed rows now have their new name to compare against.
			if (result.type === 'success') ranges = rows(data.settings.ranges);
		}}
>
	<div>
		<label style="width: 9rem">Day starts at <input type="time" name="dayStart" bind:value={dayStart} required /></label>
		<p class="muted small-text" style="margin: 0.25rem 0 0">Logs before this time count for the day before.</p>
	</div>
	<div>
		<h2 style="margin: 0">Parts of your day</h2>
		<p class="muted small-text" style="margin: 0.25rem 0 0">
			Habits can be set for a part instead of an exact time, and remind you when it starts. Renaming a part keeps its habits
			on it.
		</p>
		{#each ranges as r, i (i)}
			<div class="range">
				<input type="hidden" name="rangeWas" value={r.was} />
				<input class="grow" name="rangeName" bind:value={r.name} placeholder="Morning" aria-label="Name" />
				<input type="time" name="rangeStart" bind:value={r.start} aria-label="Starts" />
				<input type="time" name="rangeEnd" bind:value={r.end} aria-label="Ends" />
				<button type="button" class="small" onclick={() => ranges.splice(i, 1)} aria-label="Remove">×</button>
			</div>
		{/each}
		<button type="button" class="small" style="margin-top: 0.35rem" onclick={() => ranges.push({ name: '', start: '12:00', end: '14:00', was: '' })}
			>+ part</button
		>
	</div>
	{#if blocked}<p class="error" role="alert">{blocked}</p>{/if}
	{#each warnings as w (w)}<p class="muted small-text" role="status">{w}</p>{/each}
	{#if missing.length}<p class="muted small-text">Removed but still in use: {missing.join(', ')}.</p>{/if}
	<button class="primary" disabled={!!blocked} title={blocked ?? undefined}>Save</button>
	{#if form?.dayError}<p class="error">{form.dayError}</p>{/if}
	{#if form?.daySaved}<p class="muted">Saved.</p>{/if}
</form>

<style>
	.small-text {
		font-size: 0.85rem;
	}
	.range {
		margin-top: 0.35rem;
	}
</style>
