<script lang="ts">
	// A Markdown note, rendered safely (src/lib/markdown.ts: no raw HTML, safe links only).
	import { renderMarkdown } from '$lib/markdown';

	let { text, small = false }: { text: string | null | undefined; small?: boolean } = $props();
	const html = $derived(renderMarkdown(text));
</script>

{#if html}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it with raw HTML off and a link allow-list -->
	<div class="md" class:md-small={small}>{@html html}</div>
{/if}

<style>
	.md {
		overflow-wrap: anywhere;
		color: var(--ink);
	}
	.md-small {
		font-size: var(--font-size-label);
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
		margin: 0 0 var(--space-inline);
	}
	.md :global(h1),
	.md :global(h2),
	.md :global(h3),
	.md :global(h4) {
		font-size: var(--font-size-body);
		margin: var(--space-inline) 0 var(--space-tight);
	}
	.md :global(h1) {
		font-size: var(--font-size-section-title);
	}
	.md :global(ul),
	.md :global(ol) {
		padding-left: var(--space-indent);
	}
	.md :global(blockquote) {
		border-left: 3px solid var(--line);
		padding-left: var(--space-inline);
		color: var(--ink-muted);
	}
	.md :global(code) {
		font-size: 0.85em;
		background: var(--surface-page);
		border: 1px solid var(--line);
		border-radius: var(--radius-mark);
		padding: 0 var(--space-tight);
	}
	.md :global(pre) {
		overflow-x: auto;
		background: var(--surface-page);
		border: 1px solid var(--line);
		border-radius: var(--radius-inset);
		padding: var(--space-inline);
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
		border: 1px solid var(--line);
		padding: var(--space-tight) var(--space-inline);
		text-align: left;
	}
	.md :global(hr) {
		border: none;
		border-top: 1px solid var(--line);
	}
</style>
