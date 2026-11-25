<script lang="ts">
	// A habit's page. Starting over from what the server has (an Undo, a cancelled change) makes the
	// page anew rather than patching its state.
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { ScheduleForm } from '$lib/forms';
	import Editor from './Editor.svelte';

	let { data, form } = $props();
	let times = $state(0);
	let openLines = $state<string[]>([]);
	let seed = $state.raw<ScheduleForm | null>(null);
	let gone = false;
	onDestroy(() => (gone = true));
	async function reset(open: string[] = [], from: ScheduleForm | null = null) {
		if (gone) return;
		// Offline there is nothing to load, and trying would show an error page.
		if (navigator.onLine) await invalidateAll();
		openLines = open;
		seed = from;
		times++;
	}
</script>

<!-- A new one starts anew for each way to start it: step by step, blank, a copy. -->
{#key `${data.id}:${data.isNew ? page.url.search : ''}:${times}`}<Editor {data} {form} {openLines} {seed} onreset={reset} />{/key}
