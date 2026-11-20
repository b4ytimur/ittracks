<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();

	const tabs = [
		{ href: '/', label: 'Today' },
		{ href: '/habits', label: 'Habits' },
		{ href: '/library', label: 'Library' },
		{ href: '/history', label: 'History' }
	];
	const active = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

<div class="app">
	<main class="content">
		{@render children()}
	</main>
	<nav class="tabs" aria-label="Main">
		{#each tabs as tab (tab.href)}
			<a href={tab.href} aria-current={active(tab.href) ? 'page' : undefined}>{tab.label}</a>
		{/each}
	</nav>
</div>
