<script lang="ts">
	let { form } = $props();
</script>

<svelte:head><title>Set up ittracks</title></svelte:head>

<main class="auth">
	<h1>Welcome to ittracks</h1>
	<p class="muted">Create the account for this server. You only do this once.</p>
	<form method="POST" class="stack">
		<label>Username <input name="username" value={form?.username ?? ''} autocomplete="username" required /></label>
		<label>Password <input name="password" type="password" autocomplete="new-password" minlength="8" required /></label>
		{#if form?.error}<p class="error">{form.error}</p>{/if}
		<button class="primary">Create account</button>
	</form>
</main>
