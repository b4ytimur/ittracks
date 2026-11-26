<script lang="ts">
	// A list of named options with stable ids (src/lib/options.ts): a Choice field's options or a
	// break habit's feelings. Renaming edits the name in place and keeps the id, so past logs
	// follow the rename. An option a log used is archived when removed, and says so.
	import type { Snippet } from 'svelte';
	import EditableList from './ui/EditableList.svelte';

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
		/** Why removing a used option archives it. */
		usedTitle: string;
		placeholder?: string;
		/** Anything more on an option's row, such as its number. */
		after?: Snippet<[Item]>;
	} = $props();
</script>

<div class="options">
	<EditableList
		items={options}
		key={(o) => o.id}
		label={(o) => o.name || label}
		mode="edit"
		layout="bare"
		ariaLabel={label}
		onmove={(_, order) => (options = order.map((id) => options.find((o) => o.id === id)!))}
	>
		{#snippet row(o, ctx)}
			<div class="option">
				{@render ctx.grip?.()}
				<input bind:value={o.name} maxlength="40" required aria-label="{label} {options.indexOf(o) + 1}" {placeholder} />
				{@render after?.(o)}
				<button type="button" class="quiet" aria-label="{used(o.id) ? 'Archive' : 'Remove'} {o.name || label}" onclick={() => (options = options.filter((x) => x.id !== o.id))}>{used(o.id) ? 'Archive' : 'Remove'}</button>
			</div>
		{/snippet}
	</EditableList>
	{#if options.some((o) => used(o.id))}<p class="meta muted">{usedTitle}</p>{/if}
	<button type="button" onclick={() => options.push({ id: crypto.randomUUID(), name: '' })}>{addLabel}</button>
</div>

<style>
	p {
		margin: 0;
	}
	.options {
		display: grid;
		gap: 0.6rem;
	}
	.options > button {
		justify-self: start;
	}
	.option {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-inline);
		align-items: center;
	}
	.option > input {
		flex: 1 1 8rem;
		min-width: 0;
	}
</style>
