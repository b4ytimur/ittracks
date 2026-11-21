<script lang="ts">
	// The day note (J3): one free Markdown note per day, on Today and the Day page. Not a
	// habit, no streak. It saves itself a moment after you stop typing; offline it waits on
	// this device and syncs later.
	import { untrack } from 'svelte';
	import NoteBox from '$lib/NoteBox.svelte';
	import { enqueue, isOffline } from '$lib/outbox.svelte';
	import { postAction } from '$lib/toast.svelte';

	let { date, text, link = true }: { date: string; text: string; link?: boolean } = $props();

	let value = $state(untrack(() => text));
	let saved = untrack(() => text);
	let status = $state<'idle' | 'saving' | 'saved' | 'local' | 'error'>('idle');
	let timer: ReturnType<typeof setTimeout> | undefined;
	const URL = '/journal?/dayNote';

	async function save() {
		const now = value;
		if (now === saved) return;
		status = 'saving';
		try {
			const res = await postAction(URL, { date, text: now });
			if (!res.ok) throw new Error('refused');
			saved = now;
			status = 'saved';
		} catch (e) {
			if (isOffline(e)) {
				enqueue(URL, [['date', date], ['text', now]], 'Day note');
				saved = now;
				status = 'local';
			} else status = 'error';
		}
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
		{ idle: '', saving: 'Saving…', saved: 'Saved', local: 'Saved on this device', error: "Couldn't save. It will try again when you type." }[status]
	);
</script>

<section class="card daynote" aria-label="Day note">
	<NoteBox bind:value label="Day note" rows={3} placeholder="Anything about today. Markdown works." />
	<div class="foot">
		<span class="muted small-text" role="status">{statusText}</span>
		{#if link}<a class="small-text" href="/journal">Journal</a>{/if}
	</div>
</section>

<style>
	.daynote {
		margin-top: 1.25rem;
	}
	.foot {
		display: flex;
		justify-content: space-between;
		margin-top: 0.3rem;
	}
	.small-text {
		font-size: 0.85rem;
	}
</style>
