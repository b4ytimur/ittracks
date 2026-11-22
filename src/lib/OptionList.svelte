<script lang="ts">
	// A list of named options with stable ids (src/lib/options.ts): a Choice field's options or a
	// break habit's feelings. Renaming edits the name in place and keeps the id, so past logs
	// follow the rename. An option a log used is archived when removed, and says so.
	import type { Snippet } from 'svelte';

	type Item = { id: string; name: string };
	let {
		options = $bindable(),
		used = () => false,
		label,
		addLabel,
		usedTitle,
		placeholder = '',
		after
	}: {
		options: Item[];
		/** Has a log used this option? Then removing it archives it. */
		used?: (id: string) => boolean;
		/** Names one input, for screen readers: "Option", "Feeling". */
		label: string;
		addLabel: string;
		/** Why removing a used option archives it, shown on its button. */
		usedTitle: string;
		placeholder?: string;
		/** Anything more on an option's row, such as its number. */
		after?: Snippet<[Item]>;
	} = $props();

	function move(i: number, by: number) {
		const j = i + by;
		if (j < 0 || j >= options.length) return;
		[options[i], options[j]] = [options[j], options[i]];
	}
</script>

<div class="options">
	{#each options as o, i (o.id)}
		<div class="option">
			<input bind:value={o.name} maxlength="40" required aria-label="{label} {i + 1}" {placeholder} />
			{@render after?.(o)}
			<span class="controls">
				<button type="button" class="small" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move {o.name || label} up">↑</button>
				<button type="button" class="small" onclick={() => move(i, 1)} disabled={i === options.length - 1} aria-label="Move {o.name || label} down">↓</button>
				{#if used(o.id)}
					<button type="button" class="small danger" title={usedTitle} onclick={() => options.splice(i, 1)}>Archive</button>
				{:else}
					<button type="button" class="small danger" onclick={() => options.splice(i, 1)}>Remove</button>
				{/if}
			</span>
		</div>
	{/each}
	<button type="button" onclick={() => options.push({ id: crypto.randomUUID(), name: '' })}>{addLabel}</button>
</div>

<style>
	.options {
		display: grid;
		gap: 0.6rem;
	}
	.options > button {
		justify-self: start;
	}
	/* The name keeps room to be read: on a narrow screen the buttons move under it, to the right. */
	.option {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.option > input {
		flex: 1 1 9rem;
		min-width: 0;
	}
	.controls {
		display: flex;
		gap: 0.4rem;
		margin-left: auto;
	}
	/* Archive and Remove take the same width, so the rows line up. */
	.controls > .danger {
		min-width: 4.6rem;
	}
</style>
