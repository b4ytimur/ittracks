<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head><title>Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Settings</h1>
	<a href="/history">Back</a>
</header>

<section class="card stack">
	<h2 style="margin-top: 0">Units</h2>
	<form method="POST" action="?/units" class="row" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<label class="grow"
			>Default weight unit for new Tasks
			<input name="weightUnit" value={data.settings.weightUnit} list="weight-units" />
		</label>
		<button>Save</button>
	</form>
	<datalist id="weight-units"><option value="kg"></option><option value="lb"></option></datalist>
	<p class="muted" style="margin: 0">Each Metric keeps its own unit; you can change it in the Task editor.</p>
	{#if form?.unitsError}<p class="error">{form.unitsError}</p>{/if}
	{#if form?.unitsSaved}<p class="muted">Saved.</p>{/if}
</section>

<section class="card stack">
	<h2 style="margin-top: 0">Password</h2>
	<p class="muted" style="margin: 0">Signed in as {data.username}.</p>
	<form method="POST" action="?/password" class="stack" use:enhance>
		<label>Current password <input name="current" type="password" autocomplete="current-password" required /></label>
		<label>New password <input name="next" type="password" autocomplete="new-password" minlength="8" required /></label>
		<button>Change password</button>
	</form>
	{#if form?.passwordError}<p class="error">{form.passwordError}</p>{/if}
	{#if form?.passwordSaved}<p class="muted">Password changed.</p>{/if}
</section>

<section class="card stack">
	<h2 style="margin-top: 0">Templates</h2>
	<p class="muted" style="margin: 0">
		Export any habit as a template from its editor. Import templates from the <a href="/habits">Habits</a> tab.
	</p>
</section>

<form method="POST" action="/logout" style="margin-top: 1.5rem"><button class="danger">Log out</button></form>
