<script lang="ts">
	// The band above the tab bar: the newest change with its Undo, how many more there are, and the
	// connection. Nothing in it goes away on a timer; it tucks under the bar while you scroll down.
	import { invalidateAll } from '$app/navigation';
	import { canUndo, type Entry } from '$lib/echo';
	import { band, dismiss } from '$lib/toast.svelte';

	let { status = '' }: { status?: string } = $props();

	const first = $derived(band.entries[0]);
	let open = $state(false);
	let tucked = $state(false);
	let said = $state('');

	$effect(() => {
		if (first) {
			said = first.text;
			tucked = false;
		}
		if (band.entries.length < 2) open = false;
	});

	let y = 0;
	function scroll() {
		const now = window.scrollY;
		if (Math.abs(now - y) < 8) return;
		tucked = now > y && now > 96 && now + window.innerHeight < document.documentElement.scrollHeight - 8;
		y = now;
	}

	async function act(e: Entry) {
		dismiss(e.id);
		if (e.error) return void (await e.retry?.());
		await e.undo?.();
		said = 'Undone.';
		await invalidateAll();
	}
</script>

<svelte:window onscroll={scroll} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

{#snippet acts(e: Entry)}
	{#if e.error && e.retry}<button type="button" class="small echo-act" aria-label="Retry: {e.text}" onclick={() => act(e)}>Retry</button>
	{:else if canUndo(e)}<button type="button" class="small echo-act" aria-label="Undo: {e.text}" onclick={() => act(e)}>Undo</button>{/if}
{/snippet}

<div class="band" class:tucked data-mode={band.select ? 'select' : 'use'}>
	<p class="vh" role="status">{said}</p>
	{#if band.select}
		{@render band.select()}
	{:else if first || status}
		<div class="echo focus-inset">
			<span class="echo-text">{[first?.text, status].filter(Boolean).join(' · ')}</span>
			{#if first}
				<span class="echo-acts">
					{@render acts(first)}
					{#if band.entries.length > 1}
						<button type="button" class="small quiet echo-more" aria-expanded={open} aria-controls="band-history" aria-label="{band.entries.length - 1} earlier changes" onclick={() => (open = !open)}
							>{band.entries.length - 1} more</button
						>
					{/if}
				</span>
			{/if}
		</div>
	{/if}
	<ol class="history" id="band-history" hidden={!open}>
		{#each band.entries.slice(1) as e (e.id)}
			<li><span class="echo-text">{e.text}</span><span class="echo-acts">{@render acts(e)}</span></li>
		{/each}
	</ol>
</div>
