<script lang="ts">
	// One value of a record: a label over the sentence it means. It opens where it stands. A change
	// that would rewrite past days waits here for its own Save; every other change saves by itself.
	import type { Snippet } from 'svelte';

	let {
		id,
		label,
		words,
		open = $bindable(false),
		always = false,
		lead = false,
		held = false,
		was = '',
		effect = '',
		saving = false,
		problem = '',
		onsave,
		oncancel,
		onremove,
		removeLabel = 'Remove',
		children,
		question
	}: {
		id: string;
		label: string;
		words: string;
		open?: boolean;
		/** Always open, with no fold: a page that shows every control at once (Settings, TS.15). */
		always?: boolean;
		lead?: boolean;
		/** Changed, and waiting for its Save. */
		held?: boolean;
		/** What it said before. */
		was?: string;
		/** What saving it does. */
		effect?: string;
		saving?: boolean;
		problem?: string;
		onsave?: () => void;
		oncancel?: () => void;
		onremove?: () => void;
		removeLabel?: string;
		children: Snippet;
		/** The one question a held change asks. */
		question?: Snippet;
	} = $props();
</script>

<div class="su-value" class:su-lead={lead} class:su-always={always} class:open={open || always} id="line-{id}">
	<div class="su-said">
		{#if !always}<button type="button" class="fold" aria-expanded={open} aria-labelledby="{id}-l {id}-w" onclick={() => (open = !open)}><span class="chev" aria-hidden="true">›</span></button>{/if}
		<div class="su-text">
			<span class="su-lab"><span class="su-label meta" id="{id}-l">{label}</span>{#if held}<span class="tag pending"><span aria-hidden="true">→ </span>not saved</span>{/if}</span>
			<span class="su-words" id="{id}-w">{words}</span>
		</div>
	</div>
	{#if open || always}
		<div class="su-body" role="group" aria-labelledby="{id}-l" aria-describedby="{id}-w">
			{@render children()}
			{#if problem}<p class="error meta" role="alert">{problem}</p>{/if}
			{#if held}
				<div class="su-held">
					{#if was}<p class="meta su-was">Was {was}</p>{/if}
					{#if effect}<p class="meta">{effect}</p>{/if}
					{@render question?.()}
					<div class="l-cluster">
						<button type="button" class="hit" aria-disabled={saving} onclick={() => !saving && onsave?.()}>{saving ? 'Saving…' : `Save ${label.toLowerCase()}`}</button>
						<button type="button" class="hit" onclick={oncancel}>Cancel</button>
						{#if onremove}<button type="button" class="quiet hit su-end" onclick={onremove}>{removeLabel}</button>{/if}
					</div>
				</div>
			{:else if onremove}
				<div class="l-cluster"><button type="button" class="quiet hit su-end" onclick={onremove}>{removeLabel}</button></div>
			{/if}
		</div>
	{/if}
</div>

<style>
	p {
		margin: 0;
	}
</style>
