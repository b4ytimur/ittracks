<script lang="ts">
	// What a list says when it has nothing to show, and why.
	let { kind = 'first', text, onclear }: { kind?: 'first' | 'filtered' | 'range'; text: string; onclear?: () => void } = $props();
</script>

<p class="empty-{kind}">{text}{#if kind === 'filtered' && onclear}{' '}<button type="button" class="link" onclick={onclear}>Clear filters</button>{/if}</p>
