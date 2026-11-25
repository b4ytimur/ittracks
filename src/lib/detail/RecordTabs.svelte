<script lang="ts">
	// A habit's three pages.
	let { habit, at }: { habit: string; at: 'details' | 'chain' | 'stats' } = $props();
	const tabs = $derived([
		{ id: 'details', label: 'Details', href: `/habits/${habit}` },
		{ id: 'chain', label: 'Chain', href: `/habits/${habit}/chain` },
		{ id: 'stats', label: 'Stats', href: `/habits/${habit}/stats` }
	]);
</script>

<nav class="subtabs su-tabs" aria-label="This habit">
	<div class="subtabs-row">
		{#each tabs as t (t.id)}<a class="tab" href={t.href} data-reserve={t.label} aria-current={at === t.id ? 'page' : undefined}>{t.label}</a>{/each}
	</div>
</nav>

<style>
	nav {
		margin-block-end: var(--space-group);
	}
</style>
