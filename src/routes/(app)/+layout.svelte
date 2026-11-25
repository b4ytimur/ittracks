<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import Band from '$lib/ui/Band.svelte';
	import { showToast } from '$lib/toast.svelte';
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

	const status = $derived(
		[
			online ? '' : 'Offline. Changes are saved on this device.',
			waiting.length ? `${waiting.length} waiting to sync${outbox.syncing ? '…' : '.'}` : ''
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

<div class="app">
	{#each refused as q (q.id)}
		<div class="refused" role="alert">
			Not saved: {q.label}. {q.refused}
			<button class="small" onclick={() => tryAgain(q.id)}>{q.stale ? 'Keep mine' : 'Try again'}</button>
			<button class="small" onclick={() => showToast(`Discarded a change to ${q.label}.`, discard(q.id))}>{q.stale ? 'Use the other one' : 'Discard'}</button>
		</div>
	{/each}
	<main class="main">
		{@render children()}
	</main>
	<nav class="tabbar" aria-label="Main">
		<Band {status} />
		{#if !page.data.linkOnly}
			{#each tabs as tab (tab.href)}
				<a class="tab" href={tab.href} data-reserve={tab.label} aria-current={active(tab.href) ? 'page' : undefined}>{tab.label}</a>
			{/each}
		{/if}
	</nav>
</div>

<style>
	.refused {
		padding: var(--space-tight) var(--space-group);
		border-bottom: 1px solid var(--line);
		background: var(--surface-raised);
		color: var(--danger);
		text-align: center;
		font-size: var(--font-size-meta);
	}
</style>
