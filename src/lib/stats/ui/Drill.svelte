<script lang="ts">
	// The logs behind a number (V6): every log a bar, a day or a series is made of.
	import type { DrillRow, ValueKind } from '../engine';
	import { longDate, value } from '../format';

	let {
		title,
		rows,
		loading,
		unit,
		kind,
		onclose
	}: { title: string; rows: DrillRow[] | null; loading: boolean; unit: string; kind: ValueKind; onclose: () => void } = $props();

	let dialog = $state<HTMLDialogElement>();
	$effect(() => {
		if (dialog && !dialog.open) dialog.showModal();
	});
	const fmt = (v: number) => value(v, unit, kind);
</script>

<dialog bind:this={dialog} onclose={onclose} aria-label="Logs behind {title}">
	<div class="bar">
		<div>
			<h2>{title}</h2>
			<div class="muted meta">{loading ? 'Finding the logs…' : rows ? `${rows.length}${rows.length === 200 ? '+' : ''} ${rows.length === 1 ? 'log' : 'logs'}` : ''}</div>
		</div>
		<button type="button" class="small" onclick={() => dialog?.close()}>Close</button>
	</div>
	{#if rows}
		<ul class="list">
			{#each rows as r, i (i)}
				<li class="row-item">
					<div class="grow">
						<div><strong>{fmt(r.value)}</strong> <span class="muted">· {longDate(r.date)}</span></div>
						<div class="muted meta">{r.habit}{r.task && r.task !== r.habit ? ` · ${r.task}` : ''}{r.text ? ` · ${r.text}` : ''}</div>
					</div>
					{#if r.occId}<a class="quiet" href="/log/{r.occId}">Open</a>{/if}
				</li>
			{:else}
				<li class="muted">No logs here.</li>
			{/each}
		</ul>
	{/if}
</dialog>

<style>
	dialog {
		width: min(36rem, calc(100vw - 2rem));
		max-height: 80dvh;
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--surface-raised);
		color: var(--ink);
		padding: 1rem;
	}
	dialog::backdrop {
		background: var(--scrim);
	}
	h2 {
		margin: 0;
		font-size: var(--font-size-body);
	}
	.row-item {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--chart-grid);
	}
	.list li + li {
		margin-top: 0;
	}
	.grow {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
</style>
