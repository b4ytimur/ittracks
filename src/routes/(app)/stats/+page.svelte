<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/toast.svelte';
	import { boardSaid, filtersOn } from '$lib/stats/boards';
	import { statsOp, undoOp } from '$lib/stats/client';
	import { RANGES, rangeLabel, type BoardFilter } from '$lib/stats/model';
	import BoardTabs from '$lib/stats/ui/BoardTabs.svelte';
	import CardGrid from '$lib/stats/ui/CardGrid.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import TitleLine from '$lib/ui/TitleLine.svelte';
	import type { Way } from '$lib/ui/MenuButton.svelte';

	let { data } = $props();

	// No Edit: a card's words, chart and size change where they stand, its grip moves it, and the board's own acts
	// (rename, move, delete) are in the Boards ⋯, with its tabs dragged to move them (BoardTabs).
	let adding = $state(false);
	let newBoard = $state(false);
	let boardName = $state('');

	const board = $derived(data.board);
	const filterCount = $derived(board ? filtersOn(board.filter) : 0);

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

	/** The board's range or filter words change in place, with its line in the band and the Undo that puts back what this change touched. */
	async function patch(p: { range: string } | { filter: Partial<BoardFilter> }) {
		if (!board || ('range' in p && p.range === board.range)) return;
		const { id, name, filter } = board;
		// Only the words this change sets, so its Undo keeps the ones changed since.
		const was = 'range' in p ? { range: board.range } : { filter: Object.fromEntries(Object.keys(p.filter).map((k) => [k, filter[k as keyof BoardFilter]])) };
		const said = boardSaid(name, 'range' in p ? p : { filter: { ...filter, ...p.filter } });
		if (await op({ op: 'board.patch', id, ...p })) showToast(said, undoOp({ op: 'board.patch', id, ...was }));
	}
	const setFilter = (f: Partial<BoardFilter>) => patch({ filter: f });
	/** An Area or Tag on or off: its Undo turns that one back on the filter as it is then, so one toggled since stays. */
	async function toggle(list: 'areas' | 'tags', value: string) {
		if (!board) return;
		const { id, name, filter } = board;
		const on = !filter[list].includes(value);
		const said = boardSaid(name, { filter: { ...filter, [list]: on ? [...filter[list], value] : filter[list].filter((x) => x !== value) } });
		if (await op({ op: 'board.patch', id, toggle: { list, value, on } })) showToast(said, undoOp({ op: 'board.patch', id, toggle: { list, value, on: !on } }));
	}

	async function addBoard(template: string | null) {
		const r = await op({ op: 'board.add', template, name: template ? undefined : boardName.trim() || 'New board' });
		if (r?.id) {
			newBoard = false;
			boardName = '';
			await goto(`?board=${r.id}`);
			// An empty board opens its card picker; Close leaves the title line's New card.
			if (!template) adding = true;
		}
	}
	async function deleteBoard() {
		if (!board) return;
		const index = data.boards.findIndex((b) => b.id === board.id);
		const copy = $state.snapshot(board);
		const open = data.open === board.id;
		const r = await op({ op: 'board.delete', id: board.id });
		if (r) {
			await goto('/stats', { keepFocus: true }); // focus stays on the Boards ⋯, as a board pick keeps it
			showToast(`Deleted the board “${copy.name}”`, async () => {
				await statsOp({ op: 'board.restore', board: copy, index, open });
				await goto(`/stats?board=${copy.id}`);
			});
		}
	}
	const csv = (cardId: string) => `/stats/export?board=${board?.id}&card=${cardId}`;
	const opensWith = $derived<Way[]>(
		board
			? [
					{ label: 'Stats opens with the last board', checked: data.open === 'last', onselect: () => void op({ op: 'open', value: 'last' }) },
					{ label: 'Stats opens with this board', checked: data.open === board.id, onselect: () => void op({ op: 'open', value: board.id }) }
				]
			: []
	);
	/** The title line's ⋯: what reaches past this board. */
	const more: Way[] = [
		{ label: 'Download every log as CSV', href: '/stats/export?all=1', download: true },
		{ label: 'Your measures', href: '/settings#measures' }
	];
</script>

<svelte:head><title>Stats · ittracks</title></svelte:head>

<div class="stats-page page-wide">
	<TitleLine
		title="Stats"
		hint={board ? `${board.cards.length} ${board.cards.length === 1 ? 'card' : 'cards'}` : ''}
		add={board ? { label: 'New card', onclick: () => (adding = true) } : undefined}
		addHidden={adding}
		{more}
	/>

	<BoardTabs boards={data.boards} current={board?.id ?? null} before={[{ label: 'New board…', onselect: () => (newBoard = true) }]} after={opensWith} ondelete={deleteBoard} />

	{#if newBoard}
		<section class="card new">
			<h2>New board</h2>
			<p class="muted meta">Start from a template, made from the habits and Tasks you already have, or start empty.</p>
			<ul class="list templates">
				{#each data.templates as t (t.id)}
					<li>
						<button type="button" class="tpl" onclick={() => addBoard(t.id)}>
							<strong>{t.name}</strong>
							<span class="muted meta">{t.blurb}</span>
						</button>
					</li>
				{/each}
			</ul>
			<form class="row" onsubmit={(e) => (e.preventDefault(), addBoard(null))}>
				<label class="grow">Or an empty board called <input bind:value={boardName} maxlength="40" placeholder="New board" /></label>
				<button>Create</button>
			</form>
		</section>
	{/if}

	{#if !board}
		<p class="muted">No boards yet. Add one to see your numbers.</p>
	{:else}
		<div class="filters">
			<div class="chips" role="group" aria-label="Range">
				{#each Object.entries(RANGES) as [k, label] (k)}<button type="button" class="toggle" aria-pressed={board.range === k} onclick={() => patch({ range: k })}>{label}</button>{/each}
				{#if board.range.startsWith('since:')}<button type="button" class="toggle" aria-pressed="true">{rangeLabel(board.range)}</button>{/if}
			</div>
			<details class="filter">
				<summary class="toggle">Filter{filterCount ? ` (${filterCount})` : ''}</summary>
				<div class="card pop stack">
					<label>
						Habits
						<select value={board.filter.direction} onchange={(e) => setFilter({ direction: (e.currentTarget as HTMLSelectElement).value as BoardFilter['direction'] })}>
							<option value="all">Building and breaking</option>
							<option value="build">Only building habits</option>
							<option value="break">Only breaking habits</option>
						</select>
					</label>
					<label>
						One habit
						<select value={board.filter.habit ?? ''} onchange={(e) => setFilter({ habit: (e.currentTarget as HTMLSelectElement).value || null })}>
							<option value="">Every habit</option>
							{#each data.catalog.habits.filter((h) => !h.archived) as h (h.id)}<option value={h.id}>{h.name}</option>{/each}
						</select>
					</label>
					{#if data.catalog.identities.length}
						<label>
							Identity
							<select value={board.filter.identity ?? ''} onchange={(e) => setFilter({ identity: (e.currentTarget as HTMLSelectElement).value || null })}>
								<option value="">Any</option>
								{#each data.catalog.identities as i (i.id)}<option value={i.id}>{i.name}</option>{/each}
							</select>
						</label>
					{/if}
					{#if data.catalog.areas.length}
						<div>
							<div class="muted meta">Areas</div>
							<div class="chips">
								{#each data.catalog.areas as a (a.id)}
									<button type="button" class="toggle" aria-pressed={board.filter.areas.includes(a.id)} onclick={() => toggle('areas', a.id)}>{a.name}</button>
								{/each}
							</div>
						</div>
					{/if}
					{#if data.catalog.tags.length}
						<div>
							<div class="muted meta">Tags</div>
							<div class="chips">
								{#each data.catalog.tags as t (t)}
									<button type="button" class="toggle" aria-pressed={board.filter.tags.includes(t)} onclick={() => toggle('tags', t)}>{t}</button>
								{/each}
							</div>
						</div>
					{/if}
					{#if filterCount}
						<button type="button" onclick={() => setFilter({ areas: [], tags: [], habit: null, identity: null, direction: 'all' })}>Clear filters</button>
					{/if}
				</div>
			</details>
		</div>

		{#if !data.logged}
			<p class="muted">Log a habit and your numbers show up here.</p>
		{/if}

		<!-- New card in the title line is the board's one add, as on a habit's Stats. -->
		{#if board.cards.length === 0 && !adding}<EmptyState text="This board has no cards yet." />{/if}

		<CardGrid
			items={data.items}
			where={{ board: board.id }}
			board={{ range: board.range, filter: board.filter }}
			catalog={data.catalog}
			measures={data.measures}
			hidden={data.hidden}
			suggested={data.suggested}
			gallery={data.gallery}
			bind:adding
			{csv}
		/>
	{/if}
</div>

<style>
	.new,
	.new h2 {
		margin-top: 0;
	}
	.templates {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: var(--space-inline);
		margin-bottom: var(--space-group);
	}
	.templates li + li {
		margin-top: 0;
	}
	.tpl {
		width: 100%;
		height: 100%;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: var(--space-tight);
	}
	.filters {
		display: flex;
		gap: var(--space-inline);
		align-items: center;
		margin-bottom: var(--space-group);
		flex-wrap: wrap;
	}
	/* The range pills and Filter share one line, so the chips' own top margin goes. */
	.filters > .chips {
		margin-block-start: 0;
	}
	.filter {
		position: relative;
	}
	/* The summary is Chip's toggle, a pill beside the range pills; only the disclosure marker goes. */
	.filter summary {
		list-style: none;
	}
	.filter summary::-webkit-details-marker {
		display: none;
	}
	/* A popover hangs 4px under its trigger. */
	.filter .pop {
		position: absolute;
		z-index: var(--z-popover);
		top: calc(100% + var(--space-tight));
		left: 0;
		width: min(22rem, calc(100vw - 2 * var(--space-group)));
		box-shadow: var(--shadow-popover);
	}
</style>
