<script lang="ts">
	// Recent sessions (W11): what was done each time, and whether the target was met.
	import type { CardResult } from '../engine';
	import { shortDay } from '../format';

	let { r }: { r: CardResult } = $props();
	const met = (m: number | null) => (m === 1 ? 'Target met' : m === 0.5 ? 'Partly met' : m === 0 ? 'Not met' : null);
</script>

<ul class="sessions">
	{#each r.sessions ?? [] as s (s.occId + s.task)}
		<li>
			<div class="head">
				<strong>{shortDay(s.date)}</strong>
				<span class="muted">{s.task}</span>
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
		font-size: 0.88rem;
	}
	li {
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--chart-grid);
	}
	li:last-child {
		border-bottom: none;
	}
	.head {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.text {
		overflow-wrap: anywhere;
	}
</style>
