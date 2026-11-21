<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>{data.name} · ittracks</title></svelte:head>

<header class="bar"><h1>{data.name}</h1></header>
{#if data.state === 'logged'}
	<p class="logged" role="status">✓ {data.message}</p>
{:else if data.state === 'error'}
	<p class="error" role="alert">{data.message}</p>
{:else}
	<p>
		{#if data.state === 'notDue'}
			Not due today.
		{:else if data.state === 'done'}
			Already done today.
		{:else}
			Already {data.state} today.
		{/if}
	</p>
{/if}
{#if !data.linkOnly}
	<p>
		{#if data.state !== 'notDue' && 'occurrenceId' in data && data.occurrenceId}<a class="button" href="/log/{data.occurrenceId}">View the log</a>{/if}
		<a class="button primary" href="/">Go to Today</a>
	</p>
{/if}

<style>
	.logged {
		font-size: 1.2rem;
	}
</style>
