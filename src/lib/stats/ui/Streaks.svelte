<script lang="ts">
	// Streak cards (W8): the current streak or days clean, the best, and the last four weeks.
	import type { CardResult } from '../engine';
	import { longDate } from '../format';

	let { r }: { r: CardResult } = $props();
	const unitText = (u: string, v: number) =>
		u === 'percent'
			? 'consistency'
			: u === 'days'
				? v === 1 ? 'day clean' : 'days clean'
				: u === 'withinDays'
					? `${v === 1 ? 'day' : 'days'} within the limit`
					: u === 'withinWeeks'
						? `${v === 1 ? 'week' : 'weeks'} within the limit`
						: 'in a row';
	const bestText = (u: string, b: number) =>
		`Best ${b}${u === 'percent' ? '%' : u === 'days' || u === 'withinDays' ? (b === 1 ? ' day' : ' days') : u === 'withinWeeks' ? (b === 1 ? ' week' : ' weeks') : ''}`;
</script>

<ul class="streaks">
	{#each r.streaks ?? [] as s (s.habitId)}
		<li>
			<a href="/habits/{s.habitId}/chain" class="row-link">
				<div class="head">
					<span class="name">{s.name}</span>
					<span><strong>{s.current}{s.unit === 'percent' ? '%' : ''}</strong> <span class="muted small">{unitText(s.unit, s.current)}</span></span>
				</div>
				<div class="strip" aria-hidden="true">
					{#each s.strip as c (c.date)}<i class={c.status} title="{longDate(c.date)}: {c.status}"></i>{/each}
				</div>
				<div class="muted small">
					{#if s.best !== null}{bestText(s.unit, s.best)}{/if}{#if s.atRisk} · Do it today to keep it going{/if}
				</div>
			</a>
		</li>
	{/each}
</ul>

<style>
	.streaks {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li + li {
		margin-top: 0.65rem;
	}
	.row-link {
		display: block;
		color: inherit;
		text-decoration: none;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.strip {
		display: grid;
		grid-template-columns: repeat(28, 1fr);
		gap: 2px;
		margin: 0.3rem 0 0.1rem;
	}
	.strip i {
		height: 10px;
		border-radius: 2px;
		background: var(--grid);
	}
	.strip i.done,
	.strip i.clean {
		background: var(--accent);
	}
	.strip i.missed,
	.strip i.slip {
		background: var(--danger);
	}
	.strip i.within {
		background: var(--series-4);
	}
	.strip i.forgiven {
		background: transparent;
		box-shadow: inset 0 0 0 1.5px var(--danger);
	}
	.strip i.skipped {
		background: var(--muted);
	}
	.strip i.future,
	.strip i.rest,
	.strip i.due {
		background: var(--grid);
	}
	.small {
		font-size: 0.75rem;
	}
</style>
