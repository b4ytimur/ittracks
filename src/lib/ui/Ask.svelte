<script lang="ts">
	// For the few acts Undo can't cover: asks where it stands, the safe answer first.
	import { tick, type Snippet } from 'svelte';
	let { label, text, act, keep = 'Keep it', small = true, onact, extra }: { label: string; text: string; act: string; keep?: string; small?: boolean; onact: () => void; extra?: Snippet } = $props();
	const uid = $props.id();
	const id = `ask-${uid}`;
	let open = $state(false);
	let opener = $state<HTMLButtonElement>();
	let safe = $state<HTMLButtonElement>();
	async function ask() {
		open = !open;
		await tick();
		if (open) safe?.focus();
	}
	function close() {
		open = false;
		opener?.focus();
	}
</script>

<button type="button" class="danger" class:small bind:this={opener} aria-expanded={open} aria-controls={id} onclick={ask}>{label}</button>
<div class="ask" {id} role="group" aria-label={label} hidden={!open}>
	<span>{text}</span>
	{@render extra?.()}
	<div class="l-cluster">
		<button type="button" bind:this={safe} onclick={close}>{keep}</button>
		<button
			type="button"
			class="danger"
			onclick={() => {
				open = false;
				onact();
			}}>{act}</button
		>
	</div>
</div>
