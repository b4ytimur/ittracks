<script lang="ts">
	// The bar at the top of a list page: saved views as chips, and one Customize button that opens
	// filter, sort and grouping. Page-specific layout options go in as children, under "More options".
	import type { Snippet } from 'svelte';
	import { GROUPS, SORTS, activeFilters, sameState, viewState, type Page, type ViewSettings, type ViewState } from './views';
	import { rememberLast, viewOp } from './viewclient';
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
	let name = $state('');

	const saved = $derived(views.saved.filter((s) => s.page === page));
	const def = $derived(views.defaults[page] ?? viewState.parse({}));
	const sorts = $derived(SORTS[page] as Record<string, string>);
	const groups = $derived(GROUPS[page] as Record<string, string>);
	const filters = $derived(activeFilters(current));

	// Remember the last state after each change, but not the state the page opened with.
	let first = true;
	$effect(() => {
		const snap = JSON.stringify(current);
		if (first) {
			first = false;
			return;
		}
		void snap;
		rememberLast(page, current);
	});

	const apply = (s: ViewState) => (current = viewState.parse(JSON.parse(JSON.stringify(s))));
	const toggleArea = (id: string) =>
		(current.areas = current.areas.includes(id) ? current.areas.filter((a) => a !== id) : [...current.areas, id]);

	async function save() {
		const n = name.trim();
		if (!n) return;
		const r = await viewOp({ op: 'save', page, name: n, state: current });
		if (r) {
			views = r.views;
			name = '';
			showToast(`Saved "${n}".`);
		} else showToast("Couldn't save the view. Are you online?");
	}
	async function remove(id: string, label: string) {
		const r = await viewOp({ op: 'delete', id });
		if (r) {
			views = r.views;
			showToast(`Deleted "${label}".`);
		}
	}
	async function setOpen(value: string) {
		const r = await viewOp({ op: 'open', page, value });
		if (r) views = r.views;
	}
	async function makeDefault() {
		const r = await viewOp({ op: 'default', page, state: current });
		if (r) {
			views = r.views;
			showToast('This is now the default for this page.');
		}
	}
</script>

<div class="viewbar">
	<div class="chips" role="group" aria-label="Views">
		<button type="button" class="toggle" aria-pressed={sameState(current, def)} onclick={() => apply(def)}>Default</button>
		{#each saved as s (s.id)}
			<button type="button" class="toggle" aria-pressed={sameState(current, s.state)} onclick={() => apply(s.state)}>{s.name}</button>
		{/each}
		<button type="button" class="small" aria-expanded={open} onclick={() => (open = !open)}>
			Customize{filters ? ` · ${filters} filter${filters === 1 ? '' : 's'}` : ''}
		</button>
		{@render end?.()}
	</div>

	{#if open}
		<div class="card stack sheet">
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
				<label style="color: var(--text)"><input type="checkbox" bind:checked={current.archived} /> Include archived</label>
			{/if}

			<div class="row">
				<input class="grow" bind:value={name} maxlength="40" placeholder="Name this view, e.g. Morning" aria-label="View name"
					onkeydown={(e) => e.key === 'Enter' && save()} />
				<button class="small" onclick={save} disabled={!name.trim()}>Save as view</button>
			</div>
			{#if saved.length}
				<div class="chips" role="group" aria-label="Delete saved views">
					{#each saved as s (s.id)}
						<button type="button" class="small" onclick={() => remove(s.id, s.name)} aria-label="Delete view {s.name}">{s.name} ×</button>
					{/each}
				</div>
			{/if}

			<details>
				<summary class="small-text">More options</summary>
				<div class="stack" style="margin-top: 0.5rem">
					<label
						>This page opens with
						<select value={views.open[page] ?? 'last'} onchange={(e) => setOpen(e.currentTarget.value)}>
							<option value="last">What I used last</option>
							<option value="default">The page default</option>
							{#each saved as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
						</select>
					</label>
					<div class="row">
						<button class="small" onclick={makeDefault}>Make this the default</button>
						<button class="small link" onclick={() => apply(def)}>Reset to default</button>
					</div>
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
	summary {
		cursor: pointer;
	}
</style>
