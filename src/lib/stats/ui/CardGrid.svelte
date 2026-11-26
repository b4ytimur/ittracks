<script lang="ts">
	// A grid of cards with edit mode as a flag: add, edit, drag to move, resize, remove, and open
	// the logs behind any number. Used by Stats boards and by each habit's Stats tab. The grid is
	// the shared EditableList laid out as a grid, so moving cards works as everywhere else.
	import { invalidateAll } from '$app/navigation';
	import { dismiss, showError, showToast } from '$lib/toast.svelte';
	import type { CardResult, DrillRow, ValueKind } from '../engine';
	import type { Catalog } from '../catalog';
	import type { BoardFilter, Chart, CustomMeasure, Size, StatCard } from '../model';
	import { autoTitle } from '../catalog';
	import { fit, measureLabel, withChart, type Offer, type SlotKey } from '../sentence';
	import { statsOp } from '../client';
	import StatCardView from './StatCardView.svelte';
	import CardBuilder from './CardBuilder.svelte';
	import AddCard from './AddCard.svelte';
	import Drill from './Drill.svelte';
	import EditableList from '$lib/ui/EditableList.svelte';

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
	/** The logs behind one mark, unfolded in its card; one card at a time. */
	let drill = $state<{ card: string; title: string; rows: DrillRow[] | null; unit: string; kind: ValueKind; all: boolean } | null>(null);
	const offer = $derived<Offer>({ catalog, measures, hidden });
	const titleOf = (c: StatCard) => c.title || autoTitle(c, catalog, measures) || measureLabel(c.perLog, measures);

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
	/** The card whose settings are open, as it was when they opened, with its one entry in the band. */
	let settings = $state.raw<{ card: StatCard; was: StatCard; entry: number | null } | null>(null);
	let problem = $state('');
	function openSettings(item: Item) {
		const was = $state.snapshot(item.card) as StatCard;
		problem = '';
		// A title it was given by itself goes with what it says.
		settings = { was, entry: null, card: { ...structuredClone(was), title: was.title === autoTitle(was, catalog, measures) ? '' : was.title } };
	}
	async function saveSettings(s: NonNullable<typeof settings>, card: StatCard) {
		const at = where; // The band outlives this board, so its Undo keeps where it was.
		try {
			await statsOp({ op: 'card.save', where: at, card });
		} catch (e) {
			problem = (e as Error).message;
			// Closed by now: said where it can be seen.
			if (settings !== s) showError(problem, () => void saveSettings(s, card));
			return false;
		}
		problem = '';
		if (s.entry !== null) dismiss(s.entry);
		s.entry = showToast(`Changed “${titleOf(card)}”.`, async () => {
			settings = null;
			return !!(await op({ op: 'card.save', where: at, card: s.was }));
		});
		await invalidateAll();
		return true;
	}
	async function addNow(card: StatCard) {
		const r = await op({ op: 'card.save', where, card }, `Added “${card.title}”`);
		if (r) adding = false;
	}
	async function remove(item: Item, title: string) {
		const index = items.indexOf(item);
		const at = where; // The band outlives this board, so its Undo keeps where it was.
		const card = $state.snapshot(item.card);
		const r = await op({ op: 'card.delete', where: at, id: card.id });
		if (r) showToast(`Removed “${title}”`, async () => !!(await op({ op: 'card.save', where: at, card, index })));
	}
	async function reorder(order: string[], said: string) {
		const before = shown;
		const ids = before.map((x) => x.card.id);
		const at = where;
		shown = order.map((id) => shown.find((x) => x.card.id === id)!);
		if (await op({ op: 'card.order', where: at, ids: order })) showToast(said, async () => !!(await op({ op: 'card.order', where: at, ids })));
		else shown = before;
	}
	/** Change a card at once; the band has its Undo. */
	async function change(item: Item, card: StatCard, said: string) {
		const before = $state.snapshot(item.card) as StatCard;
		const at = where;
		const r = await op({ op: 'card.save', where: at, card });
		if (r) showToast(said, async () => !!(await op({ op: 'card.save', where: at, card: before })));
	}
	function pickWord(item: Item, key: SlotKey, v: string) {
		const r = fit($state.snapshot(item.card) as StatCard, key, v, offer);
		if (!r) return void showToast('Nothing on this card goes with that.');
		// A title it was given by itself goes with what it says now.
		const card = item.card.title === autoTitle(item.card, catalog, measures) ? { ...r.card, title: '' } : r.card;
		change(item, card, r.moved || `Changed “${titleOf(item.card)}”.`);
	}
	const setChart = (item: Item, chart: Chart) => change(item, withChart($state.snapshot(item.card) as StatCard, chart, offer), `Changed how “${titleOf(item.card)}” is drawn.`);
	const resize = (item: Item, size: Size) => change(item, { ...($state.snapshot(item.card) as StatCard), look: { ...item.card.look, size } }, `Resized “${titleOf(item.card)}”.`);

	async function openDrill(item: Item, from: string, to: string, series: string | null) {
		const label = series ? (item.result?.series.find((x) => x.key === series)?.label ?? item.result?.breakdown?.find((b) => b.key === series)?.label ?? item.result?.rows?.find((x) => x.key === series)?.label ?? '') : '';
		drill = { card: item.card.id, title: [label, from === to ? from : `${from} to ${to}`].filter(Boolean).join(' · '), rows: null, unit: '', kind: 'number', all: false };
		const mine = drill;
		try {
			const r = await statsOp<{ rows: DrillRow[]; unit: string; kind: ValueKind }>({ op: 'drill', card: item.card, ctx: board, from, to, series });
			if (drill && drill.title === mine.title && drill.card === mine.card) drill = { ...drill, rows: r.rows, unit: r.unit, kind: r.kind };
		} catch (e) {
			showToast((e as Error).message);
			drill = null;
		}
	}
</script>

{#if adding}
	<AddCard {suggested} {gallery} onadd={addNow} onbuild={(c) => (building = c)} oncancel={() => (adding = false)} />
{/if}

<EditableList
	class="cards"
	axis="grid"
	layout="bare"
	items={shown}
	key={(item) => item.card.id}
	label={(item) => titleOf(item.card)}
	itemClass={(item) => `size-${item.card.look.size}`}
	mode={editing && !readonly ? 'edit' : 'use'}
	ariaLabel="Cards"
	onmove={(_, order, text) => (void reorder(order, text), true)}
>
	{#snippet row(item, ctx)}
		{@const title = titleOf(item.card)}
		<StatCardView
			card={item.card}
			r={item.result}
			{title}
			rangeKey={item.rangeKey}
			boardRange={board.range}
			warnings={item.warnings}
			offer={readonly ? undefined : offer}
			csvHref={csv?.(item.card.id)}
			grip={ctx.grip}
			logs={drill?.card === item.card.id ? drill : null}
			onpick={readonly ? undefined : (k, v) => pickWord(item, k, v)}
			onchart={readonly ? undefined : (c) => setChart(item, c)}
			onsize={readonly ? undefined : (x) => resize(item, x)}
			onedit={readonly ? undefined : () => openSettings(item)}
			onremove={readonly ? undefined : () => remove(item, title)}
			ondrill={item.result ? (from, to, series) => openDrill(item, from, to, series) : undefined}
			onclose={() => (drill = null)}
			onall={() => drill && (drill = { ...drill, all: true })}
			onheadline={onheadline && item.card.look.chart === 'tile' ? () => onheadline(item.card) : undefined}
			headline={headlines.includes(item.card.id)}
		/>
	{/snippet}
</EditableList>

{#if building}
	<dialog class="card-settings" aria-label="A new card" onclose={() => (building = null)} {@attach (d) => (d as HTMLDialogElement).showModal()}>
		<CardBuilder initial={building} {catalog} {measures} {hidden} {board} {saving} onsave={save} oncancel={() => (building = null)} />
	</dialog>
{/if}

{#if settings}
	{@const s = settings}
	<dialog class="card-settings" aria-label="All settings of {titleOf(s.was)}" onclose={() => (settings = null)} {@attach (d) => (d as HTMLDialogElement).showModal()}>
		<CardBuilder live initial={s.card} {catalog} {measures} {hidden} {board} {problem} onsave={(card) => saveSettings(s, card)} oncancel={() => (settings = null)} />
	</dialog>
{/if}

{#if drill?.all}
	<Drill title={drill.title} rows={drill.rows} loading={false} unit={drill.unit} kind={drill.kind} onclose={() => drill && (drill = { ...drill, all: false })} />
{/if}

<style>
	.card-settings {
		inline-size: min(60rem, calc(100vw - 2 * var(--space-group)));
		max-block-size: 90dvh;
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--surface-page);
		color: var(--ink);
		padding: var(--space-group);
	}
	.card-settings::backdrop {
		background: var(--scrim);
	}
	/* The grid: six columns, each card spanning by its size. */
	:global(ul.cards) {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: var(--space-group);
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
	/* stretch: the cards are an .elist, whose rows start their content at the left (flex-start); a card's header, numbers
	   and charts take its whole width instead. */
	:global(ul.cards > li > .card) {
		flex: 1;
		align-items: stretch;
	}
	:global(ul.cards > li.size-wide),
	:global(ul.cards > li.size-full) {
		grid-column: span 6;
	}
	@media (min-width: 900px) {
		:global(ul.cards > li.size-small) {
			grid-column: span 2;
		}
		:global(ul.cards > li.size-wide) {
			grid-column: span 4;
		}
	}
	@media (max-width: 380px) {
		:global(ul.cards > li.size-small) {
			grid-column: span 6;
		}
	}
</style>
