<script lang="ts">
	let { form } = $props();
</script>

<svelte:head><title>Log in · ittracks</title></svelte:head>

<main class="auth">
	<h1>ittracks</h1>
	<form method="POST" class="stack">
		<label>Username <input name="username" value={form?.username ?? ''} autocomplete="username" required /></label>
		<label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
		{#if form?.error}<p class="error">{form.error}</p>{/if}
		<button class="primary">Log in</button>
	</form>
</main>
