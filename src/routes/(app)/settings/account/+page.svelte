<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head><title>Account · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Account</h1>
	<a href="/settings">‹ Settings</a>
</header>

<section class="card stack">
	<p style="margin: 0">Signed in as <strong>{data.username}</strong>.</p>
	<form method="POST" action="/logout"><button class="danger">Log out</button></form>
</section>

<section class="card stack">
	<h2 style="margin: 0">Change password</h2>
	<form method="POST" action="?/password" class="stack" use:enhance>
		<label>Current password <input name="current" type="password" autocomplete="current-password" required /></label>
		<label>New password <input name="next" type="password" autocomplete="new-password" minlength="8" required /></label>
		<button class="primary">Change password</button>
	</form>
	{#if form?.passwordError}<p class="error">{form.passwordError}</p>{/if}
	{#if form?.passwordSaved}<p class="muted">Password changed.</p>{/if}
</section>
