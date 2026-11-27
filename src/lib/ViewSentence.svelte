<script lang="ts">
	// A page's view as one sentence (TS.1): "Default shows everything, by time, short rows with streaks, done at the
	// end." The view's name opens the views, New view (a ghost slot) and the starting sentences (TS.10), and the view's
	// own housekeeping: Rename, Delete view, Reset view and what the page opens with, in any mode (MO: the switcher's
	// menu). Every other word is the platform's select laid over it (TS.13, AP.2). A pick changes the view at once and
	// says so in the band, with Undo and Keep as new view.
	import { tick, untrack } from 'svelte';
	import MenuButton, { type Way } from './ui/MenuButton.svelte';
	import InlineText from './ui/InlineText.svelte';
	import { DEFAULT_VIEW, PAGE_LABEL, initialView, viewState, viewStateOf, viewsOf, type Page, type ViewSettings, type ViewState } from './views';
	import { flushViews, saveView, viewOp } from './viewclient';
	import { sentence, type Word } from './view-words';
	import { showError, showToast } from './toast.svelte';

	let {
		page,
		views = $bindable(),
		current = $bindable(),
		words,
		starters = [],
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
		/** What the page default goes back to with Reset view, in the view-name menu while it differs; none, no Reset. */
		reset?: ViewState;
		/** A view's sentence in words, for the list of views and the starting sentences. */
		say?: (s: ViewState) => string;
	} = $props();

	let active = $state(untrack(() => initialView(views, page)));
	/** The view's name is a box where it stands: 'new' right after New view made it (with a hint), 'rename' from Rename. */
	let naming = $state<'new' | 'rename' | null>(null);
	let root = $state<HTMLElement>();
	/** The view just made from New view: the starting sentences stand under it until something else is chosen (TS.10). */
	let fresh = $state<string | null>(null);
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

	/** A change to the view from elsewhere on the page (a line's Hide on Today): saved, said in the band, with Undo and Keep as new view. */
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
		fresh = null;
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
		await nameBox('new');
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
		await nameBox('new');
	}
	/** The view just made takes a template's words, and its name when it still has the one it was given. */
	async function startFrom(t: { name: string; state: ViewState }) {
		const id = active;
		const before = copy(current);
		fresh = null;
		void nameClosed(); // the box and the template pressed both go, so the focus goes back to the name
		current = copy(t.state);
		store(id, current);
		const renamed = nameOf(id) === 'New view';
		if (renamed) {
			const r = await viewOp({ op: 'rename', id, name: t.name });
			if (r) views = r.views;
		}
		showToast(renamed ? `Made ${t.name} from its template.` : `${nameOf(id)} now starts from ${t.name}.`, () => {
			if (active === id) current = copy(before);
			store(id, before);
		});
	}
	/** Open the name as a box (InlineText, opened by the page) and put the cursor in it. */
	async function nameBox(kind: 'new' | 'rename') {
		naming = kind;
		await tick();
		const box = root?.querySelector<HTMLInputElement>('input.inline-text');
		box?.focus();
		box?.select();
	}
	/** The box closed: Enter or Esc leave the focus nowhere, so it goes back to the name; a press elsewhere keeps its own. */
	async function nameClosed() {
		naming = null;
		await tick();
		if (document.activeElement === document.body) root?.querySelector<HTMLElement>('.name-menu button')?.focus();
	}
	async function rename(id: string, to: string) {
		const was = nameOf(id);
		const next = to.trim();
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
		fresh = null;
		active = id;
		current = copy(s);
		void viewOp({ op: 'select', page, view: id });
	}

	async function remove() {
		const id = active;
		const gone = views.saved.find((s) => s.id === id);
		if (!gone) return;
		await flushViews();
		// Its Undo puts back only this view (and what the page opens with, when that was it), never changes made since.
		const view = $state.snapshot(gone);
		const index = views.saved.findIndex((s) => s.id === id);
		const open = views.open[page] === id;
		const r = await viewOp({ op: 'delete', id });
		if (!r) return showError(`Couldn't delete ${view.name}. It is still here.`);
		views = r.views;
		active = DEFAULT_VIEW;
		current = copy(viewStateOf(views, page, DEFAULT_VIEW)!);
		showToast(`Deleted ${view.name}.`, async () => {
			const b = await viewOp({ op: 'undelete', view, index, open });
			if (!b) return false;
			views = b.views;
			active = id;
			current = copy(view.state);
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
	async function setOpens(id: string) {
		const r = await viewOp({ op: 'open', page, value: id });
		if (r) views = r.views;
		return !!r;
	}
	/** The next choice, said in the band with Undo: the menu closes on the press, so the band is where the new one shows. */
	async function nextOpens() {
		const was = opens;
		const to = OPENS[(OPENS.findIndex((o) => o.id === was.id) + 1) % OPENS.length];
		if (!(await setOpens(to.id))) return showError(`Couldn't change what ${PAGE_LABEL[page]} opens with. It still opens with ${was.name}.`);
		showToast(`${PAGE_LABEL[page]} now opens with ${to.name}.`, () => setOpens(was.id));
	}

	/** The page default differs from what it came as, so Reset view has something to do. */
	const changed = $derived(!!reset && active === DEFAULT_VIEW && !same(current, reset));
	// The view's own acts after the views: a view you made renames and deletes, the page default resets while it differs.
	const acts = $derived<Way[]>(
		active !== DEFAULT_VIEW
			? [
					{ label: 'Rename view', onselect: () => nameBox('rename') },
					{ label: 'Delete view', onselect: remove }
				]
			: changed
				? [{ label: 'Reset view', value: 'Default as it came', onselect: resetDefault }]
				: []
	);
	const items = $derived<(Way | '-')[]>([
		...list.map((x) => ({ label: x.name, checked: x.id === active, value: x.id === active ? sentence(words) : undefined, onselect: () => select(x.id) })),
		{ label: 'New view', value: starters.length ? `A copy of ${name}, or start from a template.` : `A copy of ${name}. You name it next.`, ghost: true, onselect: () => make('New view', current).then(() => (fresh = active)) },
		'-',
		...(acts.length ? [...acts, '-' as const] : []),
		{ label: `${PAGE_LABEL[page]} opens with ${opens.name}`, value: 'Press to change', onselect: nextOpens }
	]);
	const shownOf = (w: Word) => w.shown ?? w.options.find((o) => o.value === w.value)?.label ?? '';
	const kindOf = (value: string) => (value.includes(':') ? value.slice(0, value.indexOf(':') + (value.startsWith('more:') ? 3 : 0)) : '');
	function itemsOf(w: Word): (Way | '-')[] {
		const out: (Way | '-')[] = [];
		w.options.forEach((o, i) => {
			if (i && o.value !== '_' && w.options[i - 1].value !== '_' && kindOf(o.value) !== kindOf(w.options[i - 1].value)) out.push('-');
			out.push({ label: o.label, value: o.note, checked: o.value === w.value, onselect: () => choose(w, o.value) });
		});
		return out;
	}
</script>

<div class="view-sentence" bind:this={root}>
	<div class="sentence">
		{#if naming}
			<span class="name"
				><InlineText
					value={name}
					bind:open={() => naming !== null, (v) => !v && nameClosed()}
					label="Name of {name}"
					maxlength={40}
					onsave={(v) => rename(active, v)}
				/></span
			>
		{:else}
			<span class="name-menu">
				<MenuButton class="word-button" align="start" label="{name}: the views of {PAGE_LABEL[page]}" menuLabel="Views of {PAGE_LABEL[page]}" {items}>
					{#snippet trigger()}<span class="shown name">{name}</span>{/snippet}
				</MenuButton>
			</span>
		{/if}
		<span>shows</span>
		{#each words as w (w.key)}
			<span class="part"
				>{#if w.before}<span class="before">{w.before}</span>{/if}<span class="word-menu"
					><MenuButton class="word-button" align="start" label="{w.what}: {shownOf(w)}" menuLabel={w.what} items={itemsOf(w)}
						>{#snippet trigger()}<span class="shown">{shownOf(w)}</span>{/snippet}</MenuButton
					></span
				>{w.after}</span
			>
		{/each}
	</div>
	{#if naming === 'new'}<p class="hint meta">Name it, then press a ruled word to change what it shows.</p>{/if}
	{#if fresh === active && starters.length}
		<div class="starts" role="group" aria-label="Start from a template">
			<span class="meta">Or start from</span>
			{#each starters as t (t.name)}
				<button type="button" class="toggle" onmousedown={(e) => e.preventDefault()} onclick={() => startFrom(t)}>{t.name}</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.view-sentence {
		position: relative;
		margin-block: var(--space-tight) var(--space-group);
	}
	/* Every part on one baseline: a part that ends in a comma takes the comma's taller line box, so lining parts up by
	   their tops left a word with nothing after it ("by Area" before "in my order") 4px high. */
	.sentence {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-tight);
		margin: 0;
		color: var(--ink-muted);
		line-height: var(--control-md); /* each line is an M control tall, and each word in it an S control (24) */
	}
	/* A word keeps its comma: no gap inside a part, only between parts. */
	.part {
		display: inline-flex;
		align-items: baseline;
	}
	.before {
		margin-inline-end: var(--space-tight);
	}
	.shown {
		border-bottom: 1px dashed var(--line-control);
		line-height: var(--control-sm);
		overflow-wrap: anywhere;
	}
	.name {
		font-weight: 600;
		color: var(--ink);
	}
	/* The views open under the name, from its start: the menu's own placement is for ⋯ at a row's end. */
	.name-menu,
	.word-menu {
		position: relative;
		display: inline-flex;
	}
	.starts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-inline);
		margin-block-start: var(--space-inline);
	}
	.view-sentence :global(.word-button) {
		min-height: var(--target-min);
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}
	/* Under a coarse pointer a ruled word's hit area is its line (control-md), not Button's 44px: lines are 32px apart, so a
	   taller area would take the bottom of the word (or the date) above it. */
	@media (pointer: coarse) {
		.view-sentence :global(.word-button)::before {
			inset-block: calc((100% - var(--control-md)) / 2);
		}
	}
	.hint {
		margin: var(--space-tight) 0 0;
		color: var(--ink);
	}
	@media (hover: hover) {
		.view-sentence :global(.word-button:hover .shown) {
			border-bottom-color: var(--ink);
		}
	}
</style>
