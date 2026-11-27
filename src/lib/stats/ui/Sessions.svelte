<script lang="ts">
	// Recent sessions (W11): what was done each time, and whether the target was met.
	import type { CardResult } from '../engine';
	import { shortDay } from '../format';
	import { insteadLine } from '$lib/log/places';

	let { r }: { r: CardResult } = $props();
	const met = (m: number | null) => (m === 1 ? 'Target met' : m === 0.5 ? 'Partly met' : m === 0 ? 'Not met' : null);
</script>

<ul class="sessions">
	<!-- Unkeyed: one log can hold the same Task twice (two Slots, or done there before a swap). -->
	{#each r.sessions ?? [] as s}
		<li>
			<div class="head">
				<strong>{shortDay(s.date)}</strong>
				<span class="muted">{insteadLine(s.task, s.instead)}</span>
				{#if met(s.met)}<span class="tag" class:strong={s.met === 1}>{met(s.met)}</span>{/if}
			</div>
			<div class="text">{s.text}</div>
		</li>
	{/each}
</ul>

<style>
	.sessions {
		list-style: none;
		padding: 0;
		margin: 0;
		font-size: var(--font-size-label);
	}
	li {
		padding: var(--space-inline) 0;
		border-bottom: 1px solid var(--chart-grid);
	}
	li:last-child {
		border-bottom: none;
	}
	.head {
		display: flex;
		gap: var(--space-inline);
		align-items: center;
		flex-wrap: wrap;
	}
	.text {
		overflow-wrap: anywhere;
	}
</style>
