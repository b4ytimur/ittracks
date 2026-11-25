<script lang="ts">
	// What a list says when it has nothing to show, and why.
	let { kind = 'first', text, onclear, clearLabel = 'Clear filters' }: { kind?: 'first' | 'filtered' | 'range'; text: string; onclear?: () => void; clearLabel?: string } = $props();
</script>

<p class="empty-{kind}">{text}{#if kind === 'filtered' && onclear}{' '}<button type="button" class="link" onclick={onclear}>{clearLabel}</button>{/if}</p>
