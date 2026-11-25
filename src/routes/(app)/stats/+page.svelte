<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/toast.svelte';
	import { statsOp } from '$lib/stats/client';
	import { RANGES, rangeLabel, type BoardFilter } from '$lib/stats/model';
	import CardGrid from '$lib/stats/ui/CardGrid.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import MenuButton, { type Way } from '$lib/ui/MenuButton.svelte';

	let { data } = $props();

	/** Edit mode is a flag on this same page: the grid shows handles, sizes and Edit on each card. */
	let editing = $state(false);
	let adding = $state(false);
	let newBoard = $state(false);
	let boardName = $state('');

	const board = $derived(data.board);
	const filterCount = $derived(
		board ? board.filter.areas.length + board.filter.tags.length + (board.filter.habit ? 1 : 0) + (board.filter.identity ? 1 : 0) + (board.filter.direction !== 'all' ? 1 : 0) : 0
	);

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

	function pick(id: string) {
		statsOp({ op: 'last', id }).catch(() => {});
		goto(`?board=${id}`, { keepFocus: true, noScroll: true });
	}
	const patch = (p: { name?: string; range?: string; filter?: BoardFilter }) => board && op({ op: 'board.patch', id: board.id, ...p });
	const setFilter = (f: Partial<BoardFilter>) => board && patch({ filter: { ...board.filter, ...f } });
	const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

	async function addBoard(template: string | null) {
		const r = await op({ op: 'board.add', template, name: template ? undefined : boardName.trim() || 'New board' });
		if (r?.id) {
			newBoard = false;
			boardName = '';
			await goto(`?board=${r.id}`);
			if (!template) {
				editing = true;
				adding = true;
			}
		}
	}
	async function deleteBoard() {
		if (!board) return;
		const index = data.boards.findIndex((b) => b.id === board.id);
		const copy = $state.snapshot(board);
		const r = await op({ op: 'board.delete', id: board.id });
		if (r) {
			editing = false;
			await goto('/stats');
			showToast(`Deleted the board “${copy.name}”`, async () => {
				await statsOp({ op: 'board.restore', board: copy, index });
				await goto(`/stats?board=${copy.id}`);
			});
		}
	}
	const csv = (cardId: string) => `/stats/export?board=${board?.id}&card=${cardId}`;
	const boardMenu = $derived<(Way | '-')[]>([
		{ label: 'New board…', onselect: () => (newBoard = true) },
		...(board
			? [
					'-' as const,
					...(data.boards[0]?.id !== board.id ? [{ label: 'Move left', onselect: () => void op({ op: 'board.move', id: board.id, dir: -1 }) }] : []),
					...(data.boards.at(-1)?.id !== board.id ? [{ label: 'Move right', onselect: () => void op({ op: 'board.move', id: board.id, dir: 1 }) }] : []),
					{ label: 'Delete this board', onselect: deleteBoard },
					'-' as const,
					{ label: 'Stats opens with the last board', checked: data.open === 'last', onselect: () => void op({ op: 'open', value: 'last' }) },
					{ label: 'Stats opens with this board', checked: data.open === board.id, onselect: () => void op({ op: 'open', value: board.id }) }
				]
			: [])
	]);
</script>

<svelte:head><title>Stats · ittracks</title></svelte:head>

<div class="stats-page">
	<EditChrome
		title="Stats"
		mode={editing ? 'edit' : 'use'}
		modes={board ? ['use', 'edit'] : ['use']}
		onmode={(m) => ((editing = m === 'edit'), (adding = false))}
		hints={{ use: board ? `${board.cards.length} ${board.cards.length === 1 ? 'card' : 'cards'}` : '', edit: 'Drag a card to move it. Press a word to change it.' }}
	>
		{#snippet actions()}
			{#if board}<button type="button" onclick={() => (adding = true)}>+ Card</button>{/if}
		{/snippet}
	</EditChrome>

	<nav class="subtabs boards" aria-label="Boards">
		<div class="subtabs-row">
			{#each data.boards as b (b.id)}
				{#if editing && b.id === board?.id}
					<span class="tab" aria-current="page"><InlineText value={b.name} editing label="Name of this board" maxlength={40} onsave={(v) => patch({ name: v })} /></span>
				{:else}
					<a class="tab" href="?board={b.id}" data-reserve={b.name} aria-current={b.id === board?.id ? 'page' : undefined} onclick={(e) => (e.preventDefault(), pick(b.id))}>{b.name}</a>
				{/if}
			{/each}
		</div>
		<span class="board-more"><MenuButton class="hit" label="Boards" items={boardMenu} /></span>
	</nav>

	{#if newBoard}
		<section class="card new">
			<h2>New board</h2>
			<p class="muted small">Start from a template, made from the habits and Tasks you already have, or start empty.</p>
			<ul class="list templates">
				{#each data.templates as t (t.id)}
					<li>
						<button type="button" class="tpl" onclick={() => addBoard(t.id)}>
							<strong>{t.name}</strong>
							<span class="muted small">{t.blurb}</span>
						</button>
					</li>
				{/each}
			</ul>
			<form class="row" onsubmit={(e) => (e.preventDefault(), addBoard(null))}>
				<label class="grow">Or an empty board called <input bind:value={boardName} maxlength="40" placeholder="New board" /></label>
				<button class="primary">Create</button>
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
				<summary>Filter{filterCount ? ` (${filterCount})` : ''}</summary>
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
							<div class="muted small">Areas</div>
							<div class="chips">
								{#each data.catalog.areas as a (a.id)}
									<button type="button" class="toggle" aria-pressed={board.filter.areas.includes(a.id)} onclick={() => setFilter({ areas: toggle(board.filter.areas, a.id) })}>{a.name}</button>
								{/each}
							</div>
						</div>
					{/if}
					{#if data.catalog.tags.length}
						<div>
							<div class="muted small">Tags</div>
							<div class="chips">
								{#each data.catalog.tags as t (t)}
									<button type="button" class="toggle" aria-pressed={board.filter.tags.includes(t)} onclick={() => setFilter({ tags: toggle(board.filter.tags, t) })}>{t}</button>
								{/each}
							</div>
						</div>
					{/if}
					{#if filterCount}
						<button type="button" class="small" onclick={() => setFilter({ areas: [], tags: [], habit: null, identity: null, direction: 'all' })}>Clear filters</button>
					{/if}
				</div>
			</details>
		</div>

		{#if !data.logged}
			<p class="muted">Log a habit and your numbers show up here.</p>
		{/if}

		{#if board.cards.length === 0 && !adding}
			<div class="card empty">
				<p>This board has no cards yet.</p>
				<button type="button" class="primary" onclick={() => ((editing = true), (adding = true))}>Add a card</button>
			</div>
		{/if}

		<CardGrid
			items={data.items}
			where={{ board: board.id }}
			board={{ range: board.range, filter: board.filter }}
			catalog={data.catalog}
			measures={data.measures}
			hidden={data.hidden}
			suggested={data.suggested}
			gallery={data.gallery}
			{editing}
			bind:adding
			{csv}
		/>

		<p class="muted small foot">
			<a href="/stats/export?all=1" download>Download every log as CSV</a> ·
			<a href="/settings#measures">Your measures</a>
		</p>
	{/if}
</div>

<style>
	:global(.content:has(.stats-page)) {
		max-width: 1080px;
	}
	.new,
	.new h2 {
		margin-top: 0;
	}
	.templates {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.5rem;
		margin-bottom: 0.75rem;
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
		gap: 0.2rem;
	}
	.filters {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.75rem;
		flex-wrap: wrap;
	}
	.filter {
		position: relative;
	}
	.filter summary {
		cursor: pointer;
		list-style: none;
		padding: 0.45rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface-raised);
	}
	.filter summary::-webkit-details-marker {
		display: none;
	}
	.filter .pop {
		position: absolute;
		z-index: var(--z-popover);
		top: 2.6rem;
		left: 0;
		width: min(22rem, calc(100vw - 2rem));
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.14);
	}
	.empty {
		text-align: center;
		margin-bottom: 0.75rem;
	}
	.small {
		font-size: var(--font-size-chip);
	}
	.foot {
		margin-top: 1.5rem;
		text-align: center;
	}
	.boards {
		justify-content: space-between;
		margin-block-end: var(--space-inline);
	}
	.boards .subtabs-row {
		flex-wrap: wrap;
	}
	.boards :global(button.inline-text::after) {
		width: 0;
	}
	.board-more {
		position: relative;
	}
</style>
