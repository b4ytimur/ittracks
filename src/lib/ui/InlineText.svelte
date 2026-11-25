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
		onsave: (value: string) => unknown;
		/** What the text is, for screen readers ("Rename Gym", "Name"). */
		label?: string;
		maxlength?: number;
		/** An empty name is never saved; the old one stays. */
		required?: boolean;
	} = $props();

	let open = $state(false);
	let draft = $state('');
	let box = $state<HTMLInputElement>();
	let width = $state<number>();

	async function begin(e: MouseEvent) {
		width = (e.currentTarget as HTMLElement).offsetWidth;
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
		style:--open-w="max({width ?? 0}px, 24ch)"
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
	<button type="button" class="inline-text" onclick={begin} aria-label="{label}: {value}" data-reserve={value}><span>{value}</span></button>
{:else}{value}{/if}
