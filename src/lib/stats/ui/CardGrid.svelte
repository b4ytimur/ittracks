<script lang="ts">
	// A grid of cards with edit mode as a flag: add, edit, drag to move, resize, remove, and open
	// the logs behind any number. Used by Stats boards and by each habit's Stats tab. The grid is
	// the shared EditableList laid out as a grid, so moving cards works as everywhere else.
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
	import EditableList from '$lib/ui/EditableList.svelte';
	import { SIZES } from '../model';

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
		editing = false,
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
		/** Edit mode: drag, resize, edit and remove cards. */
		editing?: boolean;
		/** Charts only: no editing (a Task's history). */
		readonly?: boolean;
		adding?: boolean;
		/** Link to a card's CSV, by card id. */
		csv?: (cardId: string) => string;
		/** Cards shown on Today (habit tab only). */
		headlines?: string[];
		onheadline?: (card: StatCard) => void;
	} = $props();

	let building = $state<StatCard | null>(null);
	/** The cards as shown: moved at once here, then refreshed from the server. */
	let shown = $derived(items);
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
			building = null;
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
	function reorder(order: string[]) {
		shown = order.map((id) => shown.find((x) => x.card.id === id)!);
		op({ op: 'card.order', where, ids: order });
	}
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

{#if building}
	<CardBuilder initial={building} {catalog} {measures} {hidden} {board} {saving} onsave={save} oncancel={() => (building = null)} />
{:else}
	{#if adding}
		<AddCard {suggested} {gallery} onadd={addNow} onbuild={(c) => (building = c)} oncancel={() => (adding = false)} />
	{/if}

	<EditableList
		class="cards"
		axis="grid"
		layout="block"
		items={shown}
		key={(item) => item.card.id}
		label={(item) => item.card.title || 'Card'}
		itemClass={(item) => item.card.look.size}
		editing={editing && !readonly}
		ariaLabel="Cards"
		onmove={(_, order) => reorder(order)}
		onremove={(item) => remove(item, item.card.title || 'Card')}
	>
		{#snippet title(item)}
			{@const t = item.card.title || 'Card'}
			<span class="tools">
				<select class="size" aria-label="Size of {t}" value={item.card.look.size} onchange={(e) => resize(item, (e.currentTarget as HTMLSelectElement).value as Size)}>
					{#each Object.entries(SIZES) as [k, label] (k)}<option value={k}>{label}</option>{/each}
				</select>
				<button type="button" class="small" onclick={() => (building = structuredClone($state.snapshot(item.card)) as StatCard)} aria-label="Edit {t}">Edit</button>
			</span>
		{/snippet}
		{#snippet row(item)}
			{@const title = item.card.title || 'Card'}
			{#if item.result}
				<StatCardView
					card={item.card}
					r={item.result}
					{title}
					rangeKey={item.rangeKey}
					warnings={item.warnings}
					editing={editing && !readonly}
					csvHref={csv?.(item.card.id)}
					onedit={readonly ? undefined : () => (building = structuredClone($state.snapshot(item.card)) as StatCard)}
					onremove={readonly ? undefined : () => remove(item, title)}
					ondrill={(from, to, series) => openDrill(item, title, from, to, series)}
					onheadline={onheadline && item.card.look.chart === 'tile' ? () => onheadline(item.card) : undefined}
					headline={headlines.includes(item.card.id)}
				/>
			{:else}
				<article class="card">
					<h3>{title}</h3>
					<p class="error">This card could not be worked out. {item.warnings[0] ?? 'Edit it or remove it.'}</p>
					<div class="row">
						<button type="button" class="small" onclick={() => (building = item.card)}>Edit</button>
						<button type="button" class="small danger" onclick={() => remove(item, title)}>Remove</button>
					</div>
				</article>
			{/if}
		{/snippet}
	</EditableList>
{/if}

{#if drill}
	<Drill title={drill.title} rows={drill.rows} loading={drill.loading} unit={drill.unit} kind={drill.kind} onclose={() => (drill = null)} />
{/if}

<style>
	/* The grid: six columns, each card spanning by its size. */
	:global(ul.cards) {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.75rem;
		align-items: stretch;
	}
	:global(ul.cards > li) {
		grid-column: span 3;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	:global(ul.cards > li + li) {
		margin-top: 0;
	}
	:global(ul.cards > li > .body) {
		flex: 1;
		display: flex;
	}
	:global(ul.cards > li > .body > *) {
		flex: 1;
	}
	:global(ul.cards > li.wide),
	:global(ul.cards > li.full) {
		grid-column: span 6;
	}
	@media (min-width: 900px) {
		:global(ul.cards > li.small) {
			grid-column: span 2;
		}
		:global(ul.cards > li.wide) {
			grid-column: span 4;
		}
	}
	@media (max-width: 380px) {
		:global(ul.cards > li.small) {
			grid-column: span 6;
		}
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
		font-weight: 400;
	}
	.size {
		width: auto;
		padding: 0.2rem 0.3rem;
		font-size: 0.8rem;
	}
	h3 {
		font-size: 0.95rem;
		margin: 0 0 0.4rem;
	}
</style>
