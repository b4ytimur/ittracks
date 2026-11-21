<script lang="ts">
	// A Markdown note, rendered safely (src/lib/markdown.ts: no raw HTML, safe links only).
	import { renderMarkdown } from '$lib/markdown';

	let { text, small = false }: { text: string | null | undefined; small?: boolean } = $props();
	const html = $derived(renderMarkdown(text));
</script>

{#if html}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it with raw HTML off and a link allow-list -->
	<div class="md" class:small>{@html html}</div>
{/if}

<style>
	.md {
		overflow-wrap: anywhere;
		color: var(--text);
	}
	.md.small {
		font-size: 0.9rem;
	}
	.md :global(> :first-child) {
		margin-top: 0;
	}
	.md :global(> :last-child) {
		margin-bottom: 0;
	}
	.md :global(p),
	.md :global(ul),
	.md :global(ol),
	.md :global(blockquote),
	.md :global(pre),
	.md :global(table) {
		margin: 0 0 0.5rem;
	}
	.md :global(h1),
	.md :global(h2),
	.md :global(h3),
	.md :global(h4) {
		font-size: 1rem;
		margin: 0.6rem 0 0.25rem;
	}
	.md :global(h1) {
		font-size: 1.1rem;
	}
	.md :global(ul),
	.md :global(ol) {
		padding-left: 1.3rem;
	}
	.md :global(blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 0.6rem;
		color: var(--muted);
	}
	.md :global(code) {
		font-size: 0.85em;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 0.2rem;
	}
	.md :global(pre) {
		overflow-x: auto;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.5rem;
	}
	.md :global(pre code) {
		border: none;
		padding: 0;
	}
	.md :global(table) {
		border-collapse: collapse;
		display: block;
		overflow-x: auto;
	}
	.md :global(th),
	.md :global(td) {
		border: 1px solid var(--border);
		padding: 0.2rem 0.4rem;
		text-align: left;
	}
	.md :global(hr) {
		border: none;
		border-top: 1px solid var(--border);
	}
</style>
