<script lang="ts">
	let { form } = $props();
</script>

<svelte:head><title>Log in · ittracks</title></svelte:head>

<main class="ob-auth">
	<h1 class="page-title">ittracks</h1>
	<form method="POST" class="card">
		<div class="field">
			<label class="label" for="user">Username</label>
			<input id="user" name="username" value={form?.username ?? ''} autocomplete="username" required aria-invalid={form?.field === 'username' || undefined} aria-describedby="user-e" />
			{#if form?.field === 'username'}<p class="error meta" id="user-e" role="alert">{form.error}</p>{/if}
		</div>
		<div class="field">
			<label class="label" for="pw">Password</label>
			<input id="pw" name="password" type="password" autocomplete="current-password" required aria-invalid={form?.field === 'password' || undefined} aria-describedby="pw-e" />
			{#if form?.field === 'password'}<p class="error meta" id="pw-e" role="alert">{form.error}</p>{/if}
		</div>
		<div><button class="primary">Log in</button></div>
	</form>
</main>

<style>
	.ob-auth {
		padding-inline: var(--space-group);
	}
	p {
		margin: 0;
	}
</style>
