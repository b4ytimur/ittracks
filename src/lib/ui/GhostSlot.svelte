<script lang="ts">
	// The ghost slot: the dashed place at the end of a list where a new one is named (EmptyState's .ghost-slot).
	// A button until pressed, then a name field in the same box. Enter adds, and with `again` stays open for the
	// next name; Escape closes; leaving the field adds what was typed. `pill` is the same slot at the end of a
	// row of chips, as tall as a chip.
	let {
		label,
		onadd,
		again = true,
		maxlength = 120,
		shape = 'row'
	}: {
		/** The words in the slot, also the field's name for screen readers. */
		label: string;
		onadd: (name: string) => void;
		again?: boolean;
		maxlength?: number;
		shape?: 'row' | 'pill';
	} = $props();

	let naming = $state<string | null>(null);

	function add(next: boolean) {
		const name = naming?.trim();
		naming = next && again && name ? '' : null;
		if (name) onadd(name);
	}
</script>

{#if naming === null}
	<button type="button" class="ghost-slot" class:pill={shape === 'pill'} onclick={() => (naming = '')}><span aria-hidden="true">+</span><span>{label}</span></button>
{:else}
	<div class="ghost-slot" class:pill={shape === 'pill'}>
		<span aria-hidden="true">+</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="inline-text name"
			aria-label={label}
			{maxlength}
			autofocus
			bind:value={naming}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					add(true);
				} else if (e.key === 'Escape') {
					e.preventDefault();
					naming = null;
				}
			}}
			onblur={() => add(false)}
		/>
	</div>
{/if}
