<script lang="ts">
	// The day note (J3): one free Markdown note per day, on Today and the Day page. Not a
	// habit, no streak. It saves itself a moment after you stop typing; offline it waits on
	// this device and syncs later.
	import { untrack } from 'svelte';
	import NoteBox from '$lib/NoteBox.svelte';
	import { save as send } from '$lib/outbox.svelte';

	let { date, text, link = true }: { date: string; text: string; link?: boolean } = $props();

	let value = $state(untrack(() => text));
	let saved = untrack(() => text);
	let status = $state<'idle' | 'saving' | 'saved' | 'local' | 'error'>('idle');
	let why = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	const URL = '/journal?/dayNote';

	async function save() {
		const now = value;
		if (now === saved) return;
		status = 'saving';
		const a = await send(URL, [['date', date], ['text', now]], 'Day note');
		if (a.kind === 'refused') {
			why = a.why;
			status = 'error';
			return;
		}
		saved = now;
		status = a.kind === 'saved' ? 'saved' : 'local';
	}

	$effect(() => {
		void value;
		untrack(() => {
			if (value === saved) return;
			clearTimeout(timer);
			timer = setTimeout(save, 1200);
		});
		return () => clearTimeout(timer);
	});

	// Leaving the page right after typing still saves.
	$effect(() => {
		const flush = () => {
			if (value !== saved) {
				clearTimeout(timer);
				void save();
			}
		};
		window.addEventListener('pagehide', flush);
		return () => {
			window.removeEventListener('pagehide', flush);
			flush();
		};
	});

	const statusText = $derived(
		{ idle: '', saving: 'Saving…', saved: 'Saved', local: 'Saved on this device', error: `Couldn't save: ${why} It will try again when you type.` }[status]
	);
</script>

<section class="card daynote" aria-label="Day note">
	<NoteBox bind:value label="Day note" rows={3} placeholder="Anything about today. Markdown works." />
	<div class="foot">
		<span class="muted meta" role="status">{statusText}</span>
		{#if link}<a class="meta" href="/history?notes">Journal</a>{/if}
	</div>
</section>

<style>
	.daynote {
		margin-top: var(--space-group);
	}
	.foot {
		display: flex;
		justify-content: space-between;
		margin-top: var(--space-tight);
	}
</style>
