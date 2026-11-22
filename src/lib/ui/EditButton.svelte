<script lang="ts">
	// The one switch into edit mode. A page holds `editing` as a flag and hands it to its lists;
	// the page itself stays the same page. Escape leaves edit mode.
	let {
		editing = $bindable(false),
		label = 'Edit',
		doneLabel = 'Done',
		look = 'button',
		onchange
	}: {
		editing?: boolean;
		label?: string;
		doneLabel?: string;
		/** A full button, or a chip for a row of chips like the view bar. */
		look?: 'button' | 'chip';
		onchange?: (editing: boolean) => void;
	} = $props();

	function set(v: boolean) {
		editing = v;
		onchange?.(v);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (editing && e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input, textarea, select')) set(false);
	}}
/>

{#if look === 'chip'}
	<button type="button" class="chip small" class:on={editing} aria-pressed={editing} onclick={() => set(!editing)}>{editing ? doneLabel : label}</button>
{:else}
	<button type="button" class:primary={editing} aria-pressed={editing} onclick={() => set(!editing)}>{editing ? doneLabel : label}</button>
{/if}
