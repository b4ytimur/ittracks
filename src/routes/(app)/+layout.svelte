<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { dismissToast, showToast, toast } from '$lib/toast.svelte';
	import { discard, outbox, retry, startOutbox } from '$lib/outbox.svelte';

	let { children } = $props();

	const tabs = [
		{ href: '/', label: 'Today' },
		{ href: '/habits', label: 'Habits' },
		{ href: '/library', label: 'Library' },
		{ href: '/history', label: 'History' },
		{ href: '/stats', label: 'Stats' },
		{ href: '/settings', label: 'Settings' }
	];
	const active = (href: string) =>
		href === '/'
			? page.url.pathname === '/'
			: page.url.pathname.startsWith(href) || (href === '/history' && page.url.pathname.startsWith('/journal'));

	const waiting = $derived(outbox.items.filter((q) => !q.refused));
	const refused = $derived(outbox.items.filter((q) => q.refused));
	async function tryAgain(id: string) {
		const n = await retry(id);
		if (n) {
			showToast(`Synced ${n} saved ${n === 1 ? 'change' : 'changes'}.`);
			await invalidateAll();
		}
	}

	let online = $state(true);
	$effect(() => {
		online = navigator.onLine;
		const up = () => (online = true);
		const down = () => (online = false);
		window.addEventListener('online', up);
		window.addEventListener('offline', down);
		const stop = startOutbox((n) => {
			showToast(`Synced ${n} saved ${n === 1 ? 'change' : 'changes'}.`);
			invalidateAll();
		});
		return () => {
			window.removeEventListener('online', up);
			window.removeEventListener('offline', down);
			stop();
		};
	});

	async function undo() {
		const u = toast.current?.undo;
		dismissToast();
		await u?.();
		await invalidateAll();
	}
</script>

<div class="app">
	{#if !online || waiting.length}
		<div class="offline" role="status">
			{#if !online}Offline. Changes are saved on this device.{/if}
			{#if waiting.length}
				{waiting.length} waiting to sync{outbox.syncing ? '…' : '.'}
			{/if}
		</div>
	{/if}
	{#each refused as q (q.id)}
		<div class="offline refused" role="alert">
			Not saved: {q.label}. {q.refused}
			<button class="small" onclick={() => tryAgain(q.id)}>{q.stale ? 'Keep mine' : 'Try again'}</button>
			<button class="small" onclick={() => showToast(`Discarded a change to ${q.label}.`, discard(q.id))}>{q.stale ? 'Use the other one' : 'Discard'}</button>
		</div>
	{/each}
	<main class="main">
		{@render children()}
	</main>
	{#if toast.current}
		<div class="toast" role="status">
			<span>{toast.current.text}</span>
			{#if toast.current.undo}<button class="small" onclick={undo}>Undo</button>{/if}
		</div>
	{/if}
	{#if !page.data.linkOnly}
		<nav class="tabs" aria-label="Main">
			{#each tabs as tab (tab.href)}
				<a href={tab.href} aria-current={active(tab.href) ? 'page' : undefined}>{tab.label}</a>
			{/each}
		</nav>
	{/if}
</div>

<style>
	.offline {
		position: sticky;
		top: 0;
		z-index: 5;
		text-align: center;
		font-size: 0.85rem;
		padding: 0.35rem 1rem;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		color: var(--muted);
	}
	.refused {
		position: static;
		color: var(--danger);
	}
	.toast {
		position: fixed;
		left: 1rem;
		right: 1rem;
		bottom: calc(4.2rem + env(safe-area-inset-bottom));
		max-width: 608px;
		margin: 0 auto;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 0.9rem;
		border-radius: var(--radius);
		background: var(--text);
		color: var(--bg);
		z-index: 10;
	}
	.toast button {
		background: transparent;
		color: var(--bg);
		border-color: var(--bg);
	}
</style>
