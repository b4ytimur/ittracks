<script lang="ts">
	// Something to copy: shown whole, and a button that says it has.
	let { text, label, lines = false }: { text: string; label: string; lines?: boolean } = $props();
	let said = $state('');
	let box = $state<HTMLElement>();
	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			said = 'Copied';
			setTimeout(() => (said = ''), 2000);
		} catch {
			// No clipboard here: select it, so the keyboard or the touch menu can copy it.
			getSelection()?.selectAllChildren(box!);
			said = 'Selected';
		}
	}
</script>

<div class="copy-field">
	<pre class="copy-value" class:lines bind:this={box}>{text}</pre>
	<button type="button" aria-label="Copy {label}" data-reserve="Selected" onclick={copy}>{said || 'Copy'}</button>
</div>

<style>
	.copy-field {
		display: flex;
		align-items: flex-start;
		gap: var(--space-inline);
	}
	pre {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: var(--space-tight) var(--space-inline);
		border: 1px solid var(--line);
		border-radius: var(--radius-control);
		font-size: var(--font-size-meta);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.lines {
		white-space: pre;
		overflow: auto;
		overflow-wrap: normal;
	}
	button {
		flex: none;
	}
</style>
