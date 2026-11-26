<script lang="ts">
	// A page's view as one sentence (TS.1): "Default shows everything, by time, short rows with streaks, done at the
	// end." The view's name opens the views, New view (a ghost slot) and the starting sentences (TS.10); every other
	// word is the platform's select laid over it (TS.13, AP.2). A pick changes the view at once and says so in the
	// band, with Undo and Keep as new view. Replaces the view bar's chips and Customize.
	import { tick, untrack } from 'svelte';
	import MenuButton, { type Way } from './ui/MenuButton.svelte';
	import InlineText from './ui/InlineText.svelte';
	import { DEFAULT_VIEW, PAGE_LABEL, initialView, viewState, viewStateOf, viewsOf, type Page, type ViewSettings, type ViewState } from './views';
	import { flushViews, saveView, viewOp } from './viewclient';
	import { sentence, type Word } from './view-words';
	import { showError, showToast } from './toast.svelte';
	import type { Mode } from './ui/list';

	let {
		page,
		views = $bindable(),
		current = $bindable(),
		words,
		starters = [],
		mode = 'use',
		reset,
		say
	}: {
		page: Page;
		views: ViewSettings;
		/** What the page shows: a working copy of the view it is on. */
		current: ViewState;
		words: Word[];
		/** Sentences a new view can start from (TS.8). */
		starters?: { name: string; state: ViewState }[];
		mode?: Mode;
		/** What the page default goes back to with Reset view; none, no Reset. */
		reset?: ViewState;
		/** A view's sentence in words, for the list of views and the starting sentences. */
		say?: (s: ViewState) => string;
	} = $props();

	let active = $state(untrack(() => initialView(views, page)));
	/** The view whose name is being typed, right after it was made. */
	let naming = $state<string | null>(null);
	const list = $derived(viewsOf(views, page));
	const nameOf = (id: string) => list.find((x) => x.id === id)?.name ?? 'Default';
	const name = $derived(nameOf(active));
	const copy = (s: ViewState) => viewState.parse(JSON.parse(JSON.stringify(s)));
	const same = (a: ViewState, b: ViewState) => JSON.stringify(viewState.parse(a)) === JSON.stringify(viewState.parse(b));

	/** Keep a view's new state here and save it a moment later. */
	function store(id: string, state: ViewState) {
		if (id === DEFAULT_VIEW) views.defaults[page] = state;
		else views.saved = views.saved.map((s) => (s.id === id ? { ...s, state } : s));
		saveView(page, state, id);
	}

	// A change the page makes itself (Library's search and tags, a drag into My order) is a change to the view it is on:
	// kept here and saved a moment later, as the view bar did. Not the state the page opened with, nor a view just switched to.
	let first = true;
	$effect(() => {
		const snap = JSON.stringify(current);
		if (first) {
			first = false;
			return;
		}
		untrack(() => {
			const state = viewState.parse(JSON.parse(snap));
			const was = viewStateOf(views, page, active);
			if (was && !same(was, state)) store(active, state);
		});
	});

	/** A change to the view from elsewhere on the page: saved, said in the band, with Undo and Keep as new view. */
	export function change(next: ViewState, said: string, called = 'New view') {
		const id = active;
		const before = copy(current);
		const after = copy(next);
		current = after;
		store(id, after);
		showToast(
			`${nameOf(id)} ${said}.`,
			() => {
				if (active === id) current = copy(before);
				store(id, before);
			},
			undefined,
			{ label: 'Keep as new view', run: () => keep(id, before, after, called) }
		);
	}

	function choose(w: Word, value: string) {
		if (w.set) return w.set(value);
		const o = w.options.find((x) => x.value === value);
		if (o) change(w.pick(value), o.said, o.name);
	}

	/** The change moves to a view of its own, and the view it was made on goes back (TS.10). */
	async function keep(from: string, before: ViewState, after: ViewState, called: string) {
		await flushViews();
		const back = await viewOp({ op: 'update', page, view: from, state: before });
		const r = back && (await viewOp({ op: 'save', page, name: called, state: after }));
		if (!r?.id) return showError("Couldn't keep it as a view. Nothing changed.");
		views = r.views;
		active = r.id;
		current = copy(after);
		const made = r.id;
		showToast(`Made ${called}. ${nameOf(from)} is back as it was.`, async () => {
			const gone = await viewOp({ op: 'delete', id: made });
			if (!gone) return false;
			const put = await viewOp({ op: 'update', page, view: from, state: after });
			if (!put) return false;
			views = put.views;
			active = from;
			current = copy(after);
			void viewOp({ op: 'select', page, view: from });
		});
		await askName(made);
	}

	/** A new view, a copy of this one or a starting sentence; its name is typed next, where it stands. */
	async function make(called: string, state: ViewState) {
		await flushViews();
		const r = await viewOp({ op: 'save', page, name: called, state: copy(state) });
		if (!r?.id) return showError("Couldn't make the view. Nothing changed.");
		views = r.views;
		active = r.id;
		current = copy(state);
		const made = r.id;
		showToast(`Made ${called}.`, async () => {
			const gone = await viewOp({ op: 'delete', id: made });
			if (!gone) return false;
			views = gone.views;
			if (active === made) select(DEFAULT_VIEW);
		});
		await askName(made);
	}
	async function askName(id: string) {
		naming = id;
		await tick();
		const box = document.querySelector<HTMLInputElement>('.view-sentence .naming');
		box?.focus();
		box?.select();
	}
	async function rename(id: string, to: string) {
		const was = nameOf(id);
		const next = to.trim();
		naming = null;
		if (!next || next === was) return;
		const r = await viewOp({ op: 'rename', id, name: next });
		if (!r) return showError(`Couldn't rename ${was}. It keeps its old name.`);
		views = r.views;
		showToast(`Renamed ${was} to ${next}.`, async () => {
			const b = await viewOp({ op: 'rename', id, name: was });
			if (b) views = b.views;
			return !!b;
		});
	}

	function select(id: string) {
		const s = viewStateOf(views, page, id);
		if (!s || id === active) return;
		active = id;
		current = copy(s);
		void viewOp({ op: 'select', page, view: id });
	}

	async function remove() {
		const id = active;
		const gone = views.saved.find((s) => s.id === id);
		if (!gone) return;
		await flushViews();
		const before = $state.snapshot(views) as ViewSettings;
		const r = await viewOp({ op: 'delete', id });
		if (!r) return showError(`Couldn't delete ${gone.name}. It is still here.`);
		views = r.views;
		active = DEFAULT_VIEW;
		current = copy(viewStateOf(views, page, DEFAULT_VIEW)!);
		showToast(`Deleted ${gone.name}.`, async () => {
			const b = await viewOp({ op: 'restore', views: before });
			if (!b) return false;
			views = b.views;
			active = id;
			current = copy(gone.state);
			void viewOp({ op: 'select', page, view: id });
		});
	}
	function resetDefault() {
		if (!reset || active !== DEFAULT_VIEW) return;
		const before = copy(current);
		current = copy(reset);
		store(DEFAULT_VIEW, current);
		showToast('Default is back as it came.', () => {
			current = copy(before);
			store(DEFAULT_VIEW, before);
		});
	}

	const OPENS = $derived([{ id: 'last', name: 'the view I was on last' }, ...list.map((x) => ({ id: x.id, name: x.name }))]);
	const opens = $derived(OPENS.find((o) => o.id === (views.open[page] ?? 'last')) ?? OPENS[0]);
	async function nextOpens() {
		const at = OPENS.findIndex((o) => o.id === opens.id);
		const to = OPENS[(at + 1) % OPENS.length];
		const r = await viewOp({ op: 'open', page, value: to.id });
		if (r) views = r.views;
	}

	const items = $derived<(Way | '-')[]>([
		...list.map((x) => ({ label: x.name, checked: x.id === active, value: x.id === active ? sentence(words) : say?.(viewStateOf(views, page, x.id) ?? current), onselect: () => select(x.id) })),
		{ label: 'New view', value: `Starts as a copy of ${name}. You name it next.`, ghost: true, onselect: () => make('New view', current) },
		...(starters.length ? ['-' as const, ...starters.map((t) => ({ label: `Start from ${t.name}`, value: say?.(t.state), onselect: () => make(t.name, t.state) }))] : []),
		'-',
		{ label: `${PAGE_LABEL[page]} opens with ${opens.name}`, value: 'Press to change', onselect: nextOpens }
	]);
	const changed = $derived(!!reset && active === DEFAULT_VIEW && !same(current, reset));
</script>

<div class="view-sentence">
	<div class="sentence">
		{#if naming === active}
			<label class="word"
				><span class="vh">Name of the view</span><input
					class="naming"
					value={name}
					maxlength="40"
					size={Math.max(6, name.length + 1)}
					onkeydown={(e) => {
						if (e.key === 'Enter') e.currentTarget.blur();
						else if (e.key === 'Escape') {
							e.currentTarget.value = name;
							e.currentTarget.blur();
						}
					}}
					onblur={(e) => rename(active, e.currentTarget.value)}
				/></label
			>
		{:else if mode === 'edit' && active !== DEFAULT_VIEW}
			<span class="name"><InlineText value={name} editing label="Name of {name}" maxlength={40} onsave={(v) => rename(active, v)} /></span>
		{:else}
			<span class="name-menu">
				<MenuButton class="word-button" label="{name}: the views of {PAGE_LABEL[page]}" menuLabel="Views of {PAGE_LABEL[page]}" {items}>
					{#snippet trigger()}<span class="shown name">{name}</span>{/snippet}
				</MenuButton>
			</span>
		{/if}
		<span>shows</span>
		{#each words as w (w.key)}
			<span class="part"
				>{#if w.before}<span class="before">{w.before}</span>{/if}<label class="word"
					><span class="vh">{w.what}</span><span class="shown" aria-hidden="true">{w.shown ?? w.options.find((o) => o.value === w.value)?.label}</span><select
						value={w.value}
						onchange={(e) => choose(w, e.currentTarget.value)}
						>{#each w.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}</select
					></label
				>{w.after}</span
			>
		{/each}
	</div>
	{#if naming === active}<p class="hint meta">Name it, then press a ruled word to change what it shows.</p>{/if}
	{#if mode === 'edit' && (changed || active !== DEFAULT_VIEW)}
		<p class="hint meta l-cluster">
			{#if changed}<button type="button" class="quiet hit" onclick={resetDefault}>Reset view</button>{/if}
			{#if active !== DEFAULT_VIEW}<button type="button" class="quiet hit" onclick={remove}>Delete view</button>{/if}
		</p>
	{/if}
</div>

<style>
	.view-sentence {
		position: relative;
		margin-block: var(--space-tight) var(--space-group);
	}
	.sentence {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-tight);
		margin: 0;
		color: var(--ink-muted);
		line-height: 2rem;
	}
	/* A word keeps its comma: no gap inside a part, only between parts. */
	.part {
		display: inline-flex;
		align-items: baseline;
	}
	.before {
		margin-inline-end: var(--space-tight);
	}
	/* The words stand as text; the control lies over them, as wide as they are (as on Stats). */
	.word {
		position: relative;
		display: inline-flex;
		align-items: center;
		min-height: var(--target-min);
		max-width: 100%;
		margin: 0;
		color: var(--ink);
		font-size: inherit;
	}
	.shown {
		border-bottom: 1px dashed var(--line-control);
		line-height: 1.5rem;
		overflow-wrap: anywhere;
	}
	.word select {
		position: absolute;
		inset: 0;
		width: 100%;
		min-height: 0;
		margin: 0;
		padding: 0;
		opacity: 0;
		cursor: pointer;
	}
	.word:has(select:focus-visible) {
		outline: var(--focus-width) solid var(--focus-ring);
		outline-offset: var(--focus-width);
		border-radius: var(--radius-mark);
	}
	.name {
		font-weight: 600;
		color: var(--ink);
	}
	.name-menu {
		display: inline-flex;
	}
	.name-menu :global(.word-button) {
		min-height: var(--target-min);
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}
	.naming {
		width: auto;
		min-height: 0;
		padding: 0;
		border: 0;
		border-bottom: 1px dashed var(--line-control);
		border-radius: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		font-weight: 600;
		line-height: 1.5rem;
	}
	.hint {
		margin: var(--space-tight) 0 0;
		color: var(--ink);
	}
	@media (hover: hover) {
		.word:hover .shown,
		.name-menu :global(.word-button:hover .shown) {
			border-bottom-color: var(--ink);
		}
	}
</style>
