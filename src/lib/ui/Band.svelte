<script lang="ts">
	// The band above the tab bar: the newest change with its Undo, how many more there are, and the
	// connection. Nothing in it goes away on a timer; it tucks under the bar while you scroll down.
	import { invalidateAll } from '$app/navigation';
	import { canUndo, type Entry } from '$lib/echo';
	import { endRest, forgotten, moreRest, rest, restText } from '$lib/rest.svelte';
	import { band, dismiss, showError } from '$lib/toast.svelte';

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

	// The rest clock. It ticks only while there is one, and is silent: it buzzes once when it ends.
	let at = $state(Date.now());
	$effect(() => {
		const r = rest.now;
		if (!r) return;
		at = Date.now();
		let buzzed = at >= r.end;
		const t = setInterval(() => {
			at = Date.now();
			if (!buzzed && at >= r.end) {
				buzzed = true;
				navigator.vibrate?.(300);
			}
			if (forgotten(r, at)) endRest();
		}, 250);
		return () => clearInterval(t);
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
		const r = await Promise.resolve()
			.then(() => e.undo?.())
			.catch(() => false);
		if (r === false || typeof r === 'string') return void showError(typeof r === 'string' ? r : `Not undone: ${e.text}`, () => act(e));
		said = 'Undone.';
		await invalidateAll();
	}
</script>

<svelte:window onscroll={scroll} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

{#snippet acts(e: Entry)}
	{#if e.error && e.retry}<button type="button" class="small echo-act" aria-label="Retry: {e.text}" onclick={() => act(e)}>Retry</button>
	{:else if canUndo(e)}<button type="button" class="small echo-act" aria-label="Undo: {e.text}" onclick={() => act(e)}>Undo</button>{/if}
{/snippet}

<div class="band" class:tucked={tucked && !rest.now} class:clocked={rest.now && !band.select} data-mode={band.select ? 'select' : 'use'}>
	<p class="vh" role="status">{said}</p>
	{#if rest.now && !band.select}
		<div class="clock" role="group" aria-label="Rest">
			<a class="echo-text" href={rest.now.href}><span class="num" role="timer">{restText(rest.now.end, at)}</span>{rest.now.label ? ` · ${rest.now.label}` : ''}</a>
			<span class="echo-acts">
				<button type="button" class="small echo-act" aria-label="15 s more rest" onclick={() => moreRest(15)}>+15 s</button>
				<button type="button" class="small echo-act" aria-label="Skip the rest" onclick={endRest}>Skip</button>
			</span>
		</div>
	{/if}
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

<style>
	.clocked {
		flex-wrap: wrap;
		min-height: var(--band-height);
		border-top: 1px solid var(--line);
	}
	.clock,
	.clocked > :global(.echo) {
		flex: 1 0 100%;
	}
	.clock {
		display: flex;
		align-items: center;
		gap: var(--space-inline);
		min-height: calc(var(--band-height) - 1px);
		padding-block: calc(var(--space-tight) - 1px) var(--space-tight);
	}
	.clock a {
		flex: 1 1 8em;
		min-width: 0;
		color: inherit;
		text-decoration: none;
		overflow-wrap: break-word;
	}
	@media (pointer: coarse) {
		.clock {
			min-height: calc(var(--target-touch) - 1px);
		}
	}
</style>
