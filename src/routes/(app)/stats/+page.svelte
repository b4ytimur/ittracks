<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/toast.svelte';
	import { statsOp } from '$lib/stats/client';
	import { RANGES, rangeLabel, type BoardFilter } from '$lib/stats/model';
	import CardGrid from '$lib/stats/ui/CardGrid.svelte';

	let { data } = $props();

	let customizing = $state(false);
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
				customizing = true;
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
			customizing = false;
			await goto('/stats');
			showToast(`Deleted the board “${copy.name}”`, async () => {
				await statsOp({ op: 'board.restore', board: copy, index });
				await goto(`?board=${copy.id}`);
			});
		}
	}
	const csv = (cardId: string) => `/stats/export?board=${board?.id}&card=${cardId}`;
</script>

<svelte:head><title>Stats · ittracks</title></svelte:head>

<div class="stats-page">
	<header class="bar">
		<h1>Stats</h1>
		{#if board}
			<button type="button" class:primary={customizing} onclick={() => ((customizing = !customizing), (adding = false))}>{customizing ? 'Done' : 'Customize'}</button>
		{/if}
	</header>

	<nav class="boards" aria-label="Boards">
		{#each data.boards as b (b.id)}
			<button type="button" class="chip" class:on={b.id === board?.id} aria-current={b.id === board?.id ? 'page' : undefined} onclick={() => pick(b.id)}>{b.name}</button>
		{/each}
		<button type="button" class="chip add" onclick={() => (newBoard = !newBoard)} aria-expanded={newBoard}>+ Board</button>
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
		{#if customizing}
			<section class="card board-tools">
				<div class="row">
					<label class="grow">Board name <input value={board.name} maxlength="40" onchange={(e) => patch({ name: (e.currentTarget as HTMLInputElement).value.trim() || board.name })} /></label>
					<label>
						Stats opens with
						<select value={data.open} onchange={(e) => op({ op: 'open', value: (e.currentTarget as HTMLSelectElement).value })}>
							<option value="last">The last board I looked at</option>
							{#each data.boards as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
						</select>
					</label>
				</div>
				<div class="row actions-row">
					<button type="button" class="primary" onclick={() => (adding = true)}>Add a card</button>
					<button type="button" onclick={() => op({ op: 'board.move', id: board.id, dir: -1 })} disabled={data.boards[0]?.id === board.id}>Move board left</button>
					<button type="button" onclick={() => op({ op: 'board.move', id: board.id, dir: 1 })} disabled={data.boards.at(-1)?.id === board.id}>Move board right</button>
					<button type="button" class="danger" onclick={deleteBoard}>Delete board</button>
				</div>
			</section>
		{/if}

		<div class="filters">
			<select class="range" aria-label="Range" value={board.range} onchange={(e) => patch({ range: (e.currentTarget as HTMLSelectElement).value })}>
				{#each Object.entries(RANGES) as [k, label] (k)}<option value={k}>{label}</option>{/each}
				{#if board.range.startsWith('since:')}<option value={board.range}>{rangeLabel(board.range)}</option>{/if}
			</select>
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
									<button type="button" class="chip" class:on={board.filter.areas.includes(a.id)} aria-pressed={board.filter.areas.includes(a.id)} onclick={() => setFilter({ areas: toggle(board.filter.areas, a.id) })}>{a.icon} {a.name}</button>
								{/each}
							</div>
						</div>
					{/if}
					{#if data.catalog.tags.length}
						<div>
							<div class="muted small">Tags</div>
							<div class="chips">
								{#each data.catalog.tags as t (t)}
									<button type="button" class="chip" class:on={board.filter.tags.includes(t)} aria-pressed={board.filter.tags.includes(t)} onclick={() => setFilter({ tags: toggle(board.filter.tags, t) })}>{t}</button>
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
				<button type="button" class="primary" onclick={() => ((customizing = true), (adding = true))}>Add a card</button>
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
			{customizing}
			bind:adding
			{csv}
		/>

		<p class="muted small foot">
			<a href="/stats/export?all=1" download>Download every log as CSV</a> ·
			<a href="/settings/stats">Your measures and stats settings</a>
		</p>
	{/if}
</div>

<style>
	:global(.content:has(.stats-page)) {
		max-width: 1080px;
	}
	.boards {
		display: flex;
		gap: 0.35rem;
		overflow-x: auto;
		padding-bottom: 0.25rem;
		margin-bottom: 0.75rem;
		scrollbar-width: thin;
	}
	.boards .chip {
		flex: none;
		background: var(--surface);
		font-size: 0.9rem;
		padding: 0.3rem 0.8rem;
		cursor: pointer;
	}
	.boards .add {
		border-style: dashed;
	}
	.new,
	.board-tools {
		margin-bottom: 0.75rem;
	}
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
	.actions-row {
		margin-top: 0.6rem;
	}
	.filters {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.75rem;
		flex-wrap: wrap;
	}
	.range {
		width: auto;
	}
	.filter {
		position: relative;
	}
	.filter summary {
		cursor: pointer;
		list-style: none;
		padding: 0.45rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
	}
	.filter summary::-webkit-details-marker {
		display: none;
	}
	.filter .pop {
		position: absolute;
		z-index: 6;
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
		font-size: 0.8rem;
	}
	.foot {
		margin-top: 1.5rem;
		text-align: center;
	}
</style>
