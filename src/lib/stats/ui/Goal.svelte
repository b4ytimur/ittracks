<script lang="ts">
	// Goal progress (W5): how far each series is toward its goal this period.
	import type { CardResult } from '../engine';
	import { value } from '../format';

	let { r, onpick }: { r: CardResult; onpick?: (series: string | null) => void } = $props();
	const fmt = (v: number | null) => value(v, r.unit, r.kind);
</script>

<ul class="goals">
	{#each r.goalRows ?? [] as g (g.key)}
		{@const top = Math.max(g.goalMax ?? g.goal ?? 0, g.value ?? 0, 1)}
		{@const pct = ((g.value ?? 0) / top) * 100}
		{@const reached = g.goal !== null && (g.value ?? 0) >= g.goal}
		{@const over = g.goalMax !== null && (g.value ?? 0) > g.goalMax}
		<li>
			<button type="button" onclick={() => onpick?.(g.key === 'all' ? null : g.key)}>
				<div class="head">
					<span class="goal-name">{g.label || `So far ${g.period}`}</span>
					<span><strong>{fmt(g.value)}</strong> <span class="muted">of {g.goalMax !== null ? `${fmt(g.goal)} to ${fmt(g.goalMax)}` : fmt(g.goal)}</span></span>
				</div>
				<div class="track" role="meter" aria-valuemin="0" aria-valuemax={g.goal ?? 0} aria-valuenow={g.value ?? 0} aria-label={g.label || 'Progress'}>
					{#if g.goalMax !== null && g.goal !== null}
						<span class="band" style:left="{(g.goal / top) * 100}%" style:width="{((g.goalMax - g.goal) / top) * 100}%"></span>
					{/if}
					<span class="fill" class:reached class:over style:width="{Math.min(pct, 100)}%"></span>
				</div>
				<div class="muted meta">
					{#if over}Above the band {g.period}{:else if reached}Reached {g.period}{:else if g.goal !== null}{fmt(g.goal - (g.value ?? 0))} to go {g.period}{/if}
				</div>
			</button>
		</li>
	{:else}
		<li class="muted">Set a goal for this card to see progress.</li>
	{/each}
</ul>

<style>
	.goals {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li + li {
		margin-top: var(--space-inline);
	}
	button {
		display: block;
		width: 100%;
		border: none;
		background: none;
		padding: 0;
		text-align: left;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: var(--space-inline);
		font-size: var(--font-size-label);
	}
	.goal-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.track {
		position: relative;
		height: 10px;
		border-radius: var(--radius-pill);
		background: var(--seq-1);
		margin: var(--space-tight) 0;
		overflow: hidden;
	}
	.fill {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		border-radius: var(--radius-pill);
		background: var(--accent);
	}
	.fill.reached {
		background: var(--good);
	}
	.fill.over {
		background: var(--series-4);
	}
	.band {
		position: absolute;
		top: 0;
		bottom: 0;
		background: var(--good);
		opacity: 0.25;
	}
</style>
