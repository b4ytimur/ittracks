<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>{data.name} · ittracks</title></svelte:head>

<header class="bar"><h1>{data.name}</h1></header>
<p>
	{#if data.state === 'notDue'}
		Not due today.
	{:else if data.state === 'done'}
		Already done today.
	{:else}
		Already {data.state} today.
	{/if}
</p>
<p>
	{#if data.state !== 'notDue' && data.occurrenceId}<a class="button" href="/log/{data.occurrenceId}">View the log</a>{/if}
	<a class="button primary" href="/">Go to Today</a>
</p>
