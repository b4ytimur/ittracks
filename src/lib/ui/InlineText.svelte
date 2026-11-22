<script lang="ts">
	// Text that edits in place: shown as text in use, and while editing a tap turns it into a box
	// right where it stands. Enter or leaving the box saves, Escape puts it back.
	// The page owns the value: `onsave` gets the new text and the page updates it.
	import { tick, untrack } from 'svelte';

	let {
		value,
		editing = false,
		onsave,
		label = 'Name',
		maxlength = 120,
		required = true
	}: {
		value: string;
		editing?: boolean;
		onsave: (value: string) => void | Promise<void>;
		/** What the text is, for screen readers ("Rename Gym", "Name"). */
		label?: string;
		maxlength?: number;
		/** An empty name is never saved; the old one stays. */
		required?: boolean;
	} = $props();

	let open = $state(false);
	let draft = $state('');
	let box = $state<HTMLInputElement>();

	async function begin() {
		draft = value;
		open = true;
		await tick();
		box?.focus();
		box?.select();
	}

	function finish(save: boolean) {
		if (!open) return;
		open = false;
		const v = draft.trim();
		if (save && v !== value && (v || !required)) onsave(v);
	}

	// Leaving edit mode closes an open box, saving what was typed.
	$effect(() => {
		if (!editing) untrack(() => finish(true));
	});
</script>

{#if editing && open}
	<input
		class="inline-text"
		bind:this={box}
		bind:value={draft}
		{maxlength}
		aria-label={label}
		onkeydown={(e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				finish(true);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				finish(false);
			}
		}}
		onblur={() => finish(true)}
	/>
{:else if editing}
	<button type="button" class="inline-text" onclick={begin} aria-label="{label}: {value}. Tap to change." title="Tap to change">{value}<span class="pen" aria-hidden="true">✎</span></button>
{:else}{value}{/if}

<style>
	input.inline-text {
		font-weight: inherit;
		padding: 0.15rem 0.35rem;
		width: 100%;
	}
	button.inline-text {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-weight: inherit;
		color: inherit;
		text-align: left;
		cursor: text;
		border-bottom: 1px dashed var(--muted);
		border-radius: 0;
	}
	.pen {
		margin-left: 0.3rem;
		font-size: 0.8em;
		color: var(--muted);
	}
</style>
