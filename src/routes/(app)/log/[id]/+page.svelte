<script lang="ts">
	import Log from './Log.svelte';
	import Routine from './Routine.svelte';

	let { data, form } = $props();
</script>

<!-- One log can lead to another (a routine's step, and back): each starts from its own. -->
{#if data.routine}
	{#key data.routine.occurrenceId}<Routine routine={data.routine} today={data.today} back={data.back} canLog={data.canLog} />{/key}
{:else}
	{#key data.occurrence.id}<Log {data} {form} />{/key}
{/if}
