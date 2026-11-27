<script lang="ts">
	// Text that edits in place: shown as text in use, and while editing a tap turns it into a box
	// right where it stands. Enter or leaving the box saves, Escape puts it back.
	// The page owns the value: `onsave` gets the new text and the page updates it.
	// `open` is bindable: a page opens the box itself from a menu (an item's ⋯ › Rename), in any mode.
	import { tick, untrack } from 'svelte';

	let {
		value,
		editing = false,
		open = $bindable(false),
		onsave,
		label = 'Name',
		maxlength = 120,
		required = true
	}: {
		value: string;
		editing?: boolean;
		/** The box is open. Set it to open the box from elsewhere (Rename in a menu); it goes false when the box closes. */
		open?: boolean;
		onsave: (value: string) => unknown;
		/** What the text is, for screen readers ("Rename Gym", "Name"). */
		label?: string;
		maxlength?: number;
		/** An empty name is never saved; the old one stays. */
		required?: boolean;
	} = $props();

	let draft = $state(untrack(() => (open ? value : '')));
	let box = $state<HTMLInputElement>();
	let text = $state<HTMLButtonElement>();
	let width = $state<number>();
	let started = untrack(() => open);

	async function start() {
		started = true;
		draft = value;
		await tick();
		box?.focus();
		box?.select();
	}

	function begin(e: MouseEvent) {
		width = (e.currentTarget as HTMLElement).offsetWidth;
		open = true;
	}

	// Opened by a tap or by the page: take the current text and focus the box.
	$effect(() => {
		if (open && !started) untrack(start);
		else if (!open) started = false;
	});

	/** `refocus`: Enter or Escape closed it, so the focus goes back to the text, never to the page. */
	function finish(save: boolean, refocus = false) {
		if (!open) return;
		open = false;
		const v = draft.trim();
		if (save && v !== value && (v || !required)) onsave(v);
		if (refocus) tick().then(() => text?.focus());
	}

	// Leaving edit mode closes a box a tap opened there, saving what was typed. A box a page opened in Use stays.
	let wasEditing = untrack(() => editing);
	$effect(() => {
		const now = editing;
		untrack(() => {
			if (wasEditing && !now) finish(true);
			wasEditing = now;
		});
	});
</script>

{#if open}
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
				finish(true, true);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				finish(false, true);
			}
		}}
		onblur={() => finish(true)}
	/>
{:else if editing}
	<button type="button" class="inline-text" bind:this={text} onclick={begin} aria-label="{label}: {value}" data-reserve={value}><span>{value}</span></button>
{:else}{value}{/if}
