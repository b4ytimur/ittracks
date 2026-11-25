<script lang="ts">
	// What a link with a key alone did: one sentence. Signed in, the answer is on Today.
	let { data } = $props();
</script>

<svelte:head><title>{data.name} · ittracks</title></svelte:head>

<p class="card-title" class:error={!data.ok} role={data.ok ? 'status' : 'alert'}>{data.ok ? '✓ ' : ''}{data.message}</p>
