<script lang="ts">
	// Records (W6): bests, with the day each was set.
	import type { CardResult } from '../engine';
	import { shortDay, value } from '../format';

	let { r }: { r: CardResult } = $props();
</script>

<ul class="records">
	{#each r.records ?? [] as x (x.label)}
		<li>
			<span class="muted">{x.label}</span>
			<span class="v"><strong>{value(x.value, x.unit, x.kind)}</strong>{#if x.date}<span class="muted"> · {shortDay(x.date)}</span>{/if}</span>
		</li>
	{/each}
</ul>

<style>
	.records {
		list-style: none;
		padding: 0;
		margin: 0;
		font-size: 0.9rem;
	}
	li {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--grid);
	}
	li:last-child {
		border-bottom: none;
	}
	.v {
		text-align: right;
		white-space: nowrap;
	}
</style>
