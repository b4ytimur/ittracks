<script lang="ts">
	// A grid of cards that can be customized: add, edit, move, resize, remove, and open the
	// logs behind any number. Used by Stats boards and by each habit's Stats tab.
	import { invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/toast.svelte';
	import type { CardResult, DrillRow, ValueKind } from '../engine';
	import type { Catalog } from '../catalog';
	import type { BoardFilter, CustomMeasure, Size, StatCard } from '../model';
	import { statsOp } from '../client';
	import StatCardView from './StatCardView.svelte';
	import CardBuilder from './CardBuilder.svelte';
	import AddCard from './AddCard.svelte';
	import Drill from './Drill.svelte';

	export interface Item {
		card: StatCard;
		result: CardResult | null;
		warnings: string[];
		rangeKey: string;
	}

	let {
		items,
		where,
		board,
		catalog,
		measures,
		hidden,
		suggested,
		gallery,
		customizing = false,
		readonly = false,
		adding = $bindable(false),
		csv,
		headlines = [],
		onheadline
	}: {
		items: Item[];
		where: { board: string } | { habit: string };
		board: { range: string; filter: BoardFilter };
		catalog: Catalog;
		measures: CustomMeasure[];
		hidden: string[];
		suggested: { group: string; cards: StatCard[] }[];
		gallery: { group: string; cards: StatCard[] }[];
		customizing?: boolean;
		/** Charts only: no editing (a Task's history). */
		readonly?: boolean;
		adding?: boolean;
		/** Link to a card's CSV, by card id. */
		csv?: (cardId: string) => string;
		/** Cards shown on Today (habit tab only). */
		headlines?: string[];
		onheadline?: (card: StatCard) => void;
	} = $props();

	let editing = $state<StatCard | null>(null);
	let saving = $state(false);
	let drill = $state<{ title: string; rows: DrillRow[] | null; loading: boolean; unit: string; kind: ValueKind } | null>(null);

	async function op(body: Record<string, unknown>, done?: string) {
		try {
			const r = await statsOp(body);
			await invalidateAll();
			if (done) showToast(done);
			return r;
		} catch (e) {
			showToast((e as Error).message);
			return null;
		}
	}

	async function save(card: StatCard) {
		saving = true;
		const r = await op({ op: 'card.save', where, card });
		saving = false;
		if (r) {
			editing = null;
			adding = false;
			if (r.warnings?.length) showToast(r.warnings[0]);
		}
	}
	async function addNow(card: StatCard) {
		const r = await op({ op: 'card.save', where, card }, `Added “${card.title}”`);
		if (r) adding = false;
	}
	async function remove(item: Item, title: string) {
		const index = items.indexOf(item);
		const r = await op({ op: 'card.delete', where, id: item.card.id });
		if (r)
			showToast(`Removed “${title}”`, async () => {
				await op({ op: 'card.save', where, card: item.card, index });
			});
	}
	const move = (item: Item, dir: -1 | 1) => op({ op: 'card.move', where, id: item.card.id, dir });
	const resize = (item: Item, size: Size) => op({ op: 'card.save', where, card: { ...item.card, look: { ...item.card.look, size } } });

	async function openDrill(item: Item, title: string, from: string, to: string, series: string | null) {
		const label = series ? `${title}: ${item.result?.series.find((s) => s.key === series)?.label ?? item.result?.breakdown?.find((b) => b.key === series)?.label ?? item.result?.rows?.find((x) => x.key === series)?.label ?? ''}` : title;
		const when = from === to ? from : `${from} to ${to}`;
		drill = { title: `${label} · ${when}`, rows: null, loading: true, unit: '', kind: 'number' };
		try {
			const r = await statsOp<{ rows: DrillRow[]; unit: string; kind: ValueKind }>({ op: 'drill', card: item.card, ctx: board, from, to, series });
			if (drill) drill = { ...drill, rows: r.rows, unit: r.unit, kind: r.kind, loading: false };
		} catch (e) {
			showToast((e as Error).message);
			drill = null;
		}
	}
</script>

{#if editing}
	<CardBuilder initial={editing} {catalog} {measures} {hidden} {board} {saving} onsave={save} oncancel={() => (editing = null)} />
{:else}
	{#if adding}
		<AddCard {suggested} {gallery} onadd={addNow} onbuild={(c) => (editing = c)} oncancel={() => (adding = false)} />
	{/if}

	<div class="grid" class:customizing>
		{#each items as item, i (item.card.id)}
			{@const title = item.card.title || 'Card'}
			<div class="cell {item.card.look.size}">
				{#if item.result}
					<StatCardView
						card={item.card}
						r={item.result}
						{title}
						rangeKey={item.rangeKey}
						warnings={item.warnings}
						{customizing}
						first={i === 0}
						last={i === items.length - 1}
						csvHref={csv?.(item.card.id)}
						onedit={readonly ? undefined : () => (editing = structuredClone($state.snapshot(item.card)) as StatCard)}
						onremove={readonly ? undefined : () => remove(item, title)}
						onmove={(d) => move(item, d)}
						onresize={(s) => resize(item, s)}
						ondrill={(from, to, series) => openDrill(item, title, from, to, series)}
						onheadline={onheadline && item.card.look.chart === 'tile' ? () => onheadline(item.card) : undefined}
						headline={headlines.includes(item.card.id)}
					/>
				{:else}
					<article class="card">
						<h3>{title}</h3>
						<p class="error">This card could not be worked out. {item.warnings[0] ?? 'Edit it or remove it.'}</p>
						<div class="row">
							<button type="button" class="small" onclick={() => (editing = item.card)}>Edit</button>
							<button type="button" class="small danger" onclick={() => remove(item, title)}>Remove</button>
						</div>
					</article>
				{/if}
			</div>
		{/each}
	</div>
{/if}

{#if drill}
	<Drill title={drill.title} rows={drill.rows} loading={drill.loading} unit={drill.unit} kind={drill.kind} onclose={() => (drill = null)} />
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.75rem;
		align-items: stretch;
	}
	.cell {
		grid-column: span 3;
		min-width: 0;
		display: flex;
	}
	.cell > :global(*) {
		flex: 1;
	}
	.cell.wide,
	.cell.full {
		grid-column: span 6;
	}
	@media (min-width: 900px) {
		.cell.small {
			grid-column: span 2;
		}
		.cell.wide {
			grid-column: span 4;
		}
	}
	@media (max-width: 380px) {
		.cell.small {
			grid-column: span 6;
		}
	}
	.customizing .cell > :global(.card) {
		outline: 1px dashed var(--border);
		outline-offset: 2px;
	}
	h3 {
		font-size: 0.95rem;
		margin: 0 0 0.4rem;
	}
</style>
