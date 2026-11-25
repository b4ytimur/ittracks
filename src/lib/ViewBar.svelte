<script lang="ts">
	// The bar at the top of a list page: the page's views as chips, exactly one of them on, a ghost slot to make a new
	// one, and Customize, which changes the view you are on (filter, sort, grouping) and saves as you go.
	// Page-specific layout options go in as children, under "More options".
	import { untrack, type Snippet } from 'svelte';
	import GhostSlot from './ui/GhostSlot.svelte';
	import {
		DEFAULT_VIEW,
		GROUPS,
		SORTS,
		activeFilters,
		initialView,
		sameState,
		viewState,
		viewStateOf,
		viewsOf,
		type Page,
		type ViewSettings,
		type ViewState
	} from './views';
	import { flushViews, saveView, viewOp } from './viewclient';
	import { showToast } from './toast.svelte';

	let {
		page,
		views = $bindable(),
		current = $bindable(),
		areas = [],
		identities = [],
		habits = [],
		statuses = null,
		direction = false,
		archived = false,
		children,
		end
	}: {
		page: Page;
		views: ViewSettings;
		/** What the page shows: a working copy of the view it is on. Changing it changes that view. */
		current: ViewState;
		areas?: { id: string; name: string; icon: string }[];
		identities?: string[];
		habits?: { id: string; name: string }[];
		statuses?: Record<string, string> | null;
		direction?: boolean;
		archived?: boolean;
		children?: Snippet;
		/** More controls at the end of the chip row, such as the page's Edit switch. */
		end?: Snippet;
	} = $props();

	let open = $state(false);
	/** The view the page is on, by id: one chip is on, never two, even when two views show the same thing. */
	let active = $state(untrack(() => initialView(views, page)));

	const list = $derived(viewsOf(views, page));
	const activeName = $derived(list.find((x) => x.id === active)?.name ?? 'Default');
	const sorts = $derived(SORTS[page] as Record<string, string>);
	const groups = $derived(GROUPS[page] as Record<string, string>);
	const filters = $derived(activeFilters(current));

	// A change on the page is a change to the view it is on: kept here, so going back to it shows it, and saved a
	// moment later. Not the state the page opened with (a link can add a filter to it), and not a view just switched
	// to, which is that view already.
	let first = true;
	$effect(() => {
		const snap = JSON.stringify(current);
		if (first) {
			first = false;
			return;
		}
		untrack(() => {
			const state = viewState.parse(JSON.parse(snap));
			const id = active;
			const was = viewStateOf(views, page, id);
			if (!was || sameState(was, state)) return;
			if (id === DEFAULT_VIEW) views.defaults[page] = state;
			else views.saved = views.saved.map((s) => (s.id === id ? { ...s, state } : s));
			saveView(page, state, id);
		});
	});

	const copy = (s: ViewState) => viewState.parse(JSON.parse(JSON.stringify(s)));
	const toggleArea = (id: string) =>
		(current.areas = current.areas.includes(id) ? current.areas.filter((a) => a !== id) : [...current.areas, id]);

	function select(id: string) {
		const s = viewStateOf(views, page, id);
		if (!s || id === active) return;
		active = id;
		current = copy(s);
		viewOp({ op: 'select', page, view: id });
	}
	/** A new view starts as a copy of the one you are on; Customize opens on it. */
	async function create(name: string) {
		await flushViews();
		const r = await viewOp({ op: 'save', page, name, state: $state.snapshot(current) });
		if (!r?.id) return showToast("Couldn't make the view. Are you online?");
		views = r.views;
		active = r.id;
		open = true;
		showToast(`Made "${name}".`);
	}
	async function remove() {
		const id = active;
		const gone = views.saved.find((s) => s.id === id);
		if (!gone) return;
		await flushViews();
		const r = await viewOp({ op: 'delete', id });
		if (!r) return showToast("Couldn't delete the view. Are you online?");
		views = r.views;
		active = DEFAULT_VIEW;
		current = copy(viewStateOf(views, page, DEFAULT_VIEW)!);
		showToast(`Deleted "${gone.name}".`);
	}
	async function setOpen(value: string) {
		const r = await viewOp({ op: 'open', page, value });
		if (r) views = r.views;
	}
</script>

<div class="viewbar">
	<div class="chips" role="group" aria-label="Views">
		{#each list as v (v.id)}
			<button type="button" class="toggle" aria-pressed={active === v.id} onclick={() => select(v.id)}>{v.name}</button>
		{/each}
		<GhostSlot shape="pill" label="New view" maxlength={40} again={false} onadd={create} />
		<button type="button" class="small" aria-expanded={open} onclick={() => (open = !open)}>
			Customize{filters ? ` · ${filters} filter${filters === 1 ? '' : 's'}` : ''}
		</button>
		{@render end?.()}
	</div>

	{#if open}
		<div class="card stack sheet" role="group" aria-label="Customize {activeName}">
			<div class="row head">
				<span class="grow">Changes save to <strong>{activeName}</strong>.</span>
				{#if active !== DEFAULT_VIEW}<button type="button" class="small" onclick={remove}>Delete view</button>{/if}
			</div>
			{#if areas.length}
				<div>
					<span class="muted small-text">Areas</span>
					<div class="chips" role="group" aria-label="Filter by Area">
						{#each areas as a (a.id)}
							<button type="button" class="toggle" aria-pressed={current.areas.includes(a.id)} onclick={() => toggleArea(a.id)}>{a.icon} {a.name}</button>
						{/each}
						<button type="button" class="toggle" aria-pressed={current.areas.includes('')} onclick={() => toggleArea('')}>No area</button>
					</div>
				</div>
			{/if}
			<div class="row wrap">
				{#if direction}
					<label class="grow"
						>Type
						<select bind:value={current.direction}>
							<option value="all">Build and break</option>
							<option value="build">Build only</option>
							<option value="break">Break only</option>
						</select>
					</label>
				{/if}
				{#if statuses}
					<label class="grow"
						>Status
						<select bind:value={current.status}>
							{#each Object.entries(statuses) as [k, label] (k)}<option value={k}>{label}</option>{/each}
						</select>
					</label>
				{/if}
				{#if identities.length}
					<label class="grow"
						>Identity
						<select bind:value={current.identity}>
							<option value={null}>Any</option>
							{#each identities as i (i)}<option value={i}>{i}</option>{/each}
						</select>
					</label>
				{/if}
				{#if habits.length}
					<label class="grow"
						>Habit
						<select bind:value={current.habit}>
							<option value={null}>All habits</option>
							{#each habits as h (h.id)}<option value={h.id}>{h.name}</option>{/each}
						</select>
					</label>
				{/if}
			</div>
			<div class="row wrap">
				{#if Object.keys(sorts).length > 1}
					<label class="grow"
						>Sort
						<select bind:value={current.sort}>
							{#each Object.entries(sorts) as [k, label] (k)}<option value={k}>{label}</option>{/each}
						</select>
					</label>
				{/if}
				{#if Object.keys(groups).length > 1}
					<label class="grow"
						>Group
						<select bind:value={current.group}>
							{#each Object.entries(groups) as [k, label] (k)}<option value={k}>{label}</option>{/each}
						</select>
					</label>
				{/if}
			</div>
			{#if archived}
				<label style="color: var(--ink)"><input type="checkbox" bind:checked={current.archived} /> Include archived</label>
			{/if}

			<details>
				<summary class="small-text">More options</summary>
				<div class="stack" style="margin-top: 0.5rem">
					<label
						>This page opens with
						<select value={views.open[page] ?? 'last'} onchange={(e) => setOpen(e.currentTarget.value)}>
							<option value="last">The view I was on last</option>
							{#each list as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
						</select>
					</label>
					{@render children?.()}
				</div>
			</details>
		</div>
	{/if}
</div>

<style>
	.viewbar {
		display: block;
		margin-bottom: 0.75rem;
	}
	.sheet {
		margin-top: 0.5rem;
	}
	.wrap {
		flex-wrap: wrap;
	}
	.head {
		align-items: center;
	}
	summary {
		cursor: pointer;
	}
</style>
