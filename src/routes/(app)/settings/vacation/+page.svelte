<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const shortDate = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<svelte:head><title>Vacation · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Vacation</h1>
	<a href="/settings">‹ Settings</a>
</header>

<section class="card stack">
	<p class="muted small-text" style="margin: 0">
		Pause every habit for a while. Paused days aren't due and never break a streak. Break-habit counters keep running.
		To pause one habit, use Pause in its editor.
	</p>
	{#each data.vacations as v (v.id)}
		<form method="POST" action="?/unvacation" class="row" style="align-items: center" use:enhance>
			<input type="hidden" name="id" value={v.id} />
			<span class="grow">{shortDate(v.start)} to {shortDate(v.end)}{v.note ? ` · ${v.note}` : ''}{v.end < data.today ? ' (past)' : ''}</span>
			<button class="small">Remove</button>
		</form>
	{:else}
		<p class="muted" style="margin: 0">No vacations yet.</p>
	{/each}
	<form method="POST" action="?/vacation" class="row" use:enhance>
		<label class="grow">From <input type="date" name="start" value={data.today} required /></label>
		<label class="grow">To <input type="date" name="end" value={data.today} min={data.today} required /></label>
		<label class="grow">Note <input name="note" placeholder="optional" /></label>
		<button>Add</button>
	</form>
	{#if form?.vacationError}<p class="error">{form.vacationError}</p>{/if}
</section>

<style>
	.small-text {
		font-size: 0.85rem;
	}
</style>
