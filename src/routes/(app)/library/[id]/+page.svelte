<script lang="ts">
	// A Task's page; see the habit's for why it starts over instead of patching its state.
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Editor from './Editor.svelte';

	let { data, form } = $props();
	let times = $state(0);
	let openLines = $state<string[]>([]);
	let gone = false;
	onDestroy(() => (gone = true));
	async function reset(open: string[] = []) {
		if (gone) return;
		// Offline there is nothing to load, and trying would show an error page.
		if (navigator.onLine) await invalidateAll();
		openLines = open;
		times++;
	}
</script>

{#key `${data.taskId}:${times}`}<Editor {data} {form} {openLines} onreset={reset} />{/key}
