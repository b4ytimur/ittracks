<script lang="ts">
	// Logging out never loses a log: it names what waits on this device and offers to wait for it.
	import { tick } from 'svelte';
	import { flush, outbox } from '$lib/outbox.svelte';

	let form = $state<HTMLFormElement>();
	let waiting = $state(false);
	const left = $derived(outbox.items.length);
	const names = $derived([...new Set(outbox.items.map((q) => q.label))].join(', '));
	const refused = $derived(outbox.items.filter((q) => q.refused).length);

	$effect(() => {
		if (waiting && !left && !outbox.syncing) form?.requestSubmit();
	});
	async function wait() {
		waiting = true;
		await tick();
		await flush();
	}
</script>

{#if left}
	<p class="meta" role="status">
		Not saved yet: {names}.
		{#if refused}{refused === 1 ? 'One was' : `${refused} were`} refused, and {refused === 1 ? 'waits' : 'wait'} for your answer at the top of the page.{/if}
		{#if waiting && left > refused}{outbox.syncing ? 'Sending…' : 'No connection yet. You are logged out as soon as they are saved.'}{/if}
	</p>
{/if}
<form method="POST" action="/logout" class="l-cluster" bind:this={form}>
	{#if left > refused}
		{#if waiting}<button type="button" onclick={() => (waiting = false)}>Stay logged in</button>{:else}<button type="button" onclick={wait}>Save them, then log out</button>{/if}
	{/if}
	<button class="danger">{left ? 'Log out now' : 'Log out'}</button>
</form>
{#if left}<p class="meta muted">Logged out now, they stay on this device and are sent when you sign in here again.</p>{/if}

<style>
	p {
		margin: 0;
	}
</style>
