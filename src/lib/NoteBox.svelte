<script lang="ts">
	// A Markdown note box: plain text that grows as you type, a Write / Preview switch and a
	// tiny toolbar. What is stored stays plain Markdown, so it exports to Obsidian unchanged.
	import Markdown from '$lib/Markdown.svelte';

	let {
		value = $bindable(''),
		label = 'Notes',
		placeholder = 'Markdown works: **bold**, - lists, [links](https://…)',
		rows = 3,
		max = 20000,
		name,
		hint
	}: {
		value?: string;
		label?: string;
		placeholder?: string;
		rows?: number;
		max?: number;
		/** Set when the box is part of a plain form post. */
		name?: string;
		hint?: string;
	} = $props();

	let preview = $state(false);
	let box = $state<HTMLTextAreaElement | null>(null);
	const id = `note-${Math.random().toString(36).slice(2, 9)}`;

	/** Grow with the text, up to most of the screen. */
	function fit() {
		if (!box) return;
		box.style.height = 'auto';
		box.style.height = `${Math.min(box.scrollHeight + 2, window.innerHeight * 0.7)}px`;
	}
	$effect(() => {
		void value;
		void preview;
		queueMicrotask(fit);
	});

	/** Wrap the selection (or a placeholder word) in Markdown marks. */
	function wrap(before: string, after: string, fallback: string) {
		if (!box) return;
		const { selectionStart: a, selectionEnd: b } = box;
		const picked = value.slice(a, b) || fallback;
		value = value.slice(0, a) + before + picked + after + value.slice(b);
		queueMicrotask(() => {
			box?.focus();
			box?.setSelectionRange(a + before.length, a + before.length + picked.length);
		});
	}

	/** Start each selected line (or the current one) with a list mark. */
	function list() {
		if (!box) return;
		const a = value.lastIndexOf('\n', box.selectionStart - 1) + 1;
		const end = value.indexOf('\n', box.selectionEnd);
		const b = end === -1 ? value.length : end;
		const lines = value.slice(a, b).split('\n').map((l) => (l.startsWith('- ') ? l : `- ${l}`));
		value = value.slice(0, a) + lines.join('\n') + value.slice(b);
		queueMicrotask(() => box?.focus());
	}
</script>

<div class="notebox">
	<div class="head">
		<label for={id} class="lbl">{label}</label>
		<div class="tools" role="toolbar" aria-label="{label}: formatting">
			{#if !preview}
				<button type="button" class="tool" aria-label="Bold" onclick={() => wrap('**', '**', 'bold')}><b>B</b></button>
				<button type="button" class="tool" aria-label="List" onclick={list}>•</button>
				<button type="button" class="tool" aria-label="Link" onclick={() => wrap('[', '](https://)', 'link')}>🔗</button>
			{/if}
			<button type="button" class="tool switch" aria-pressed={preview} onclick={() => (preview = !preview)}>{preview ? 'Write' : 'Preview'}</button>
		</div>
	</div>
	{#if preview}
		<div class="preview" aria-live="polite">
			{#if value.trim()}<Markdown text={value} />{:else}<span class="muted">Nothing written yet.</span>{/if}
		</div>
		{#if name}<input type="hidden" {name} {value} />{/if}
	{:else}
		<textarea {id} {name} bind:this={box} bind:value {rows} maxlength={max} {placeholder} oninput={fit}></textarea>
	{/if}
	{#if hint}<p class="muted hint">{hint}</p>{/if}
</div>

<style>
	.notebox {
		margin-top: 0.25rem;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.lbl {
		flex: 1;
		min-width: 0;
	}
	.tools {
		display: flex;
		gap: 0.25rem;
	}
	.tool {
		padding: 0.1rem 0.5rem;
		font-size: 0.8rem;
		min-width: 2rem;
	}
	.switch {
		color: var(--accent);
	}
	textarea {
		margin-top: 0.25rem;
		resize: vertical;
		line-height: 1.4;
	}
	.preview {
		margin-top: 0.25rem;
		min-height: 3.2rem;
		padding: 0.5rem 0.6rem;
		border: 1px dashed var(--line);
		border-radius: 8px;
		background: var(--surface-raised);
	}
	.hint {
		font-size: 0.8rem;
		margin: 0.2rem 0 0;
	}
</style>
