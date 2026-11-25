<script lang="ts" generics="T">
	// The one list every editable list in the app is built from. `editing` and `selecting` are
	// flags on the same list, so the list a page shows in use is the list it edits, and the two
	// can't drift apart.
	//
	// editing:   a handle on each row to drag (mouse, touch, pen), with the arrow keys on the
	//            handle as the keyboard way; a remove button on each row; an add button under it.
	// selecting: a labelled checkbox on each row, and a tap anywhere on the row ticks it instead
	//            of following its link. Shift-click ticks a range. Several lists on one page can
	//            share one `selected` set (pass a SvelteSet); a list only adds and removes its own keys.
	//
	// The list knows nothing about what a row is: the page renders it with `row` and gets moves
	// back as keys (see list.ts). Drops inside a row only happen where `canDrop` allows them.
	//
	// Nesting, the outliner way: a row's `children` can hold another EditableList. Indent drops a
	// row inside the row it is over (or the right arrow puts it inside the row above); outdent
	// (`onoutdent`, in a nested list) takes it out to just after the row holding the list, by a
	// drag left past the list's edge or the left arrow.
	import { tick, type Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import { applyMove, dropPosition, gridDrop, rangeKeys, withDescendants, type Mode, type Move, type Position, type RowContext } from './list';

	let {
		items,
		key,
		label,
		mode: wanted,
		editing: wantsEdit = false,
		selecting: wantsSelect = false,
		selected,
		selectScope = 'item',
		childKeys,
		canDrop,
		onmove,
		onoutdent,
		onremove,
		removeLabel = 'Remove',
		onadd,
		addLabel = 'Add',
		addInUse = false,
		row,
		rowCard = false,
		href,
		holder,
		actions,
		density = 'regular',
		title,
		children,
		empty,
		layout = 'row',
		axis = 'y',
		itemClass,
		ariaLabel,
		class: klass = ''
	}: {
		items: T[];
		/** A stable, unique key per item. */
		key: (item: T) => string;
		/** The item's name for screen readers ("Move Gym", "Select Gym"). Defaults to the key. */
		label?: (item: T) => string;
		/** One of three, so edit and select are never both on. Without it, `editing` and `selecting` say which (select wins). */
		mode?: Mode;
		editing?: boolean;
		selecting?: boolean;
		/** Ticked keys, owned by the page. Pass a SvelteSet so rows update when it changes. */
		selected?: Set<string>;
		/** Ticking a row ticks what is inside it too ("unit"; needs `childKeys`), or the row alone ("item"). */
		selectScope?: 'unit' | 'item' | ((item: T) => 'unit' | 'item');
		/** The keys inside a row, for "unit". */
		childKeys?: (key: string) => string[];
		/** Whether a move is allowed. Without it, rows can go before and after each other, never inside. */
		canDrop?: (move: Move) => boolean;
		/** A row was moved. `order` is this list's keys afterwards (without the key, for a move inside a row). */
		onmove?: (move: Move, order: string[]) => void;
		/** In a list nested inside a row: the row with this key moves out, to just after the row holding the list. */
		onoutdent?: (key: string) => void;
		/** Shows a remove button on each row while editing. */
		onremove?: (item: T) => void;
		/** The remove button's word: Remove, Archive, Hide... or one per item. */
		removeLabel?: string | ((item: T) => string);
		/** Adds to the list. With `rowCard`, an empty slot at the end of the list takes the new one's name. */
		onadd?: (name?: string) => void;
		/** The slot shows in use too (a page whose list is there to be added to). */
		addInUse?: boolean;
		addLabel?: string;
		row: Snippet<[T, RowContext]>;
		/** The list draws the card: the handle and the verb sit inside it, and `row` renders its content only. */
		rowCard?: boolean;
		/** With `rowCard`, in use: the whole card follows the link on `a.name` in the row. */
		href?: (item: T) => string | undefined;
		/** With `rowCard`: this row holds others, so it and its `children` draw as one unit. */
		holder?: (item: T) => boolean;
		/** With `rowCard`, in use: what stands at the end of the row. */
		actions?: Snippet<[T, RowContext]>;
		density?: 'regular' | 'compact';
		/** With layout "block": the title in the bar above the row, beside the handle and remove button. */
		title?: Snippet<[T, RowContext]>;
		/**
		 * "row" (the default): handle, row and remove button side by side, for rows of one line.
		 * "block": a bar with the handle, title and remove button above the row at full width,
		 * for big items such as a page section that holds a list of its own.
		 * "bare": `row` draws all of it and puts the handle (`ctx.grip`) where it belongs.
		 */
		layout?: 'row' | 'block' | 'bare';
		/**
		 * "y" (the default): one item under another. "grid": items flow in a grid the page lays out
		 * with CSS on `class` (and `itemClass` for spans); drops go before or after the nearest cell,
		 * and every arrow key moves one place earlier or later. No drops inside a cell.
		 */
		axis?: 'y' | 'grid';
		/** A class for each item's <li>, such as its size in a grid. */
		itemClass?: (item: T) => string;
		/**
		 * What sits under a row, inside it: usually another EditableList for what the item holds.
		 * It moves with the row when the row is dragged, and drops are worked out on the row itself.
		 */
		children?: Snippet<[T, RowContext]>;
		/** Shown when there are no items. */
		empty?: Snippet;
		ariaLabel?: string;
		class?: string;
	} = $props();

	const mode = $derived<Mode>(wanted ?? (wantsSelect ? 'select' : wantsEdit ? 'edit' : 'use'));
	const editing = $derived(mode === 'edit');
	const selecting = $derived(mode === 'select');
	const scopeOf = (item: T) => (typeof selectScope === 'function' ? selectScope(item) : selectScope);

	const nameOf = (item: T) => label?.(item) ?? key(item);
	const removeOf = (item: T) => (typeof removeLabel === 'function' ? removeLabel(item) : removeLabel);
	const keys = $derived(items.map(key));
	const uid = `el-${Math.random().toString(36).slice(2, 9)}`;

	// ----- Moves -----

	let list = $state<HTMLUListElement>();
	let announce = $state('');
	const allowed = (m: Move) => (canDrop ? canDrop(m) : m.position !== 'inside');
	/** A move that leaves the order as it is isn't shown or sent. */
	const changes = (m: Move) => m.position === 'inside' || applyMove(keys, m).join('\n') !== keys.join('\n');

	async function commit(m: Move, refocus: boolean) {
		const order = applyMove(keys, m);
		const item = items[keys.indexOf(m.key)];
		const target = items[keys.indexOf(m.target)];
		onmove?.(m, order);
		announce =
			m.position === 'inside'
				? `${nameOf(item)} moved inside ${target ? nameOf(target) : 'the row'}.`
				: `${nameOf(item)} moved to position ${order.indexOf(m.key) + 1} of ${order.length}.`;
		if (refocus) await focusHandle(m.key);
	}

	async function outdent(k: string, refocus: boolean) {
		const item = items[keys.indexOf(k)];
		onoutdent?.(k);
		announce = `${nameOf(item)} moved out, after the row that held it.`;
		if (refocus) await focusHandle(k);
	}

	/** Moving a row can take the focus off its handle, or the row to another list: put it back. */
	async function focusHandle(k: string) {
		await tick();
		const li = `li[data-key="${CSS.escape(k)}"]`;
		const find = (from: string) => document.querySelector<HTMLElement>(`${from}${li} > .head > .handle, ${from}${li} > .card > .slot > .handle, ${from}${li} > .group-heading > .slot > .handle`);
		(find(`#${uid} > `) ?? find(''))?.focus();
	}

	// ----- Dragging -----

	let drag = $state<{
		key: string;
		startX: number;
		startY: number;
		startScroll: number;
		x: number;
		y: number;
		dx: number;
		dy: number;
		over: string | null;
		pos: Position | null;
		/** Held far enough left of a nested list to outdent. */
		out: boolean;
	} | null>(null);
	/** How far left of the list's edge the pointer goes to outdent. */
	const OUTDENT_PX = 16;
	let raf = 0;

	const rows = () => (list ? Array.from(list.querySelectorAll<HTMLElement>(':scope > li[data-row]')) : []);

	function start(e: PointerEvent, k: string) {
		if (e.button !== 0 || !onmove) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { key: k, startX: e.clientX, startY: e.clientY, startScroll: window.scrollY, x: e.clientX, y: e.clientY, dx: 0, dy: 0, over: null, pos: null, out: false };
		// No text gets selected while a row is held.
		window.getSelection()?.removeAllRanges();
		document.documentElement.classList.add('el-dragging');
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(scrollStep);
	}

	function follow(e: PointerEvent) {
		if (!drag) return;
		drag.x = e.clientX;
		drag.y = e.clientY;
		locate();
	}

	/** Work out which row the pointer is over, and where on it the row would land. */
	function locate() {
		if (!drag) return;
		const d = drag;
		d.dy = d.y - d.startY + (window.scrollY - d.startScroll);
		// A nested row follows the pointer left, toward the level it would outdent to.
		d.dx = axis === 'grid' ? d.x - d.startX : onoutdent ? Math.min(0, d.x - d.startX) : 0;
		d.out = !!onoutdent && axis === 'y' && !!list && d.x < list.getBoundingClientRect().left - OUTDENT_PX;
		if (d.out) {
			d.over = d.pos = null;
			return;
		}
		const others = rows().filter((r) => r.dataset.key !== d.key);
		let over: string | null = null;
		let pos: Position | null = null;
		if (axis === 'grid') {
			const cells = others.map((r) => ({ key: r.dataset.key!, box: r.getBoundingClientRect() }));
			const hit = gridDrop(d.x, d.y, cells, list?.getBoundingClientRect().width ?? 0);
			if (hit) {
				const m = { key: d.key, target: hit.key, position: hit.position };
				if (allowed(m) && changes(m)) [over, pos] = [hit.key, hit.position];
			}
		} else if (others.length) {
			// The first row whose bottom is below the pointer; past the last row means after it.
			const r = others.find((x) => x.getBoundingClientRect().bottom > d.y) ?? others[others.length - 1];
			// Where on the row is worked out on its own line, not on what sits under it.
			const head = (layout !== 'row' ? r : (r.querySelector(':scope > .head, :scope > .card') ?? r)).getBoundingClientRect();
			const target = r.dataset.key!;
			const nest = allowed({ key: d.key, target, position: 'inside' });
			pos = d.y < head.top ? 'before' : d.y > head.bottom ? 'after' : dropPosition(d.y, head, nest);
			const m = { key: d.key, target, position: pos };
			over = allowed(m) && changes(m) ? target : null;
			if (!over) pos = null;
		}
		d.over = over;
		d.pos = pos;
	}

	/** Scroll the page while a row is held near the top or bottom edge. */
	function scrollStep() {
		if (!drag) return;
		const top = 64;
		const bottom = window.innerHeight - 96; // clear of the tab bar
		const v = drag.y < top ? -Math.ceil((top - drag.y) / 4) : drag.y > bottom ? Math.ceil((drag.y - bottom) / 4) : 0;
		if (v) {
			window.scrollBy(0, v);
			locate();
		}
		raf = requestAnimationFrame(scrollStep);
	}

	function stop() {
		drag = null;
		cancelAnimationFrame(raf);
		document.documentElement.classList.remove('el-dragging');
	}

	function end() {
		if (!drag) return;
		const d = drag;
		stop();
		if (d.out) outdent(d.key, false);
		else if (d.over && d.pos) commit({ key: d.key, target: d.over, position: d.pos }, false);
	}

	function cancel() {
		stop();
	}

	/** The keyboard way: arrows move one place; right arrow indents into the row above where allowed, left arrow outdents. */
	function keydown(e: KeyboardEvent, k: string) {
		const i = keys.indexOf(k);
		if (axis !== 'grid' && e.key === 'ArrowLeft' && onoutdent) {
			e.preventDefault();
			outdent(k, true);
			return;
		}
		let m: Move | null = null;
		const earlier = e.key === 'ArrowUp' || (axis === 'grid' && e.key === 'ArrowLeft');
		const later = e.key === 'ArrowDown' || (axis === 'grid' && e.key === 'ArrowRight');
		if (earlier && i > 0) m = { key: k, target: keys[i - 1], position: 'before' };
		else if (later && i < keys.length - 1) m = { key: k, target: keys[i + 1], position: 'after' };
		else if (axis !== 'grid' && e.key === 'ArrowRight' && i > 0) m = { key: k, target: keys[i - 1], position: 'inside' };
		if (!m || !allowed(m)) return;
		e.preventDefault();
		commit(m, true);
	}

	// ----- Adding -----

	let naming = $state<string | null>(null);
	/** Enter adds it and is ready for the next one; leaving the slot adds what was typed. */
	function add(again: boolean) {
		const name = naming?.trim();
		naming = again && name ? '' : null;
		if (name) onadd?.(name);
	}

	// ----- Selecting -----

	let anchor: string | null = null;

	function toggle(k: string, range: boolean) {
		if (!selected) return;
		const on = !selected.has(k);
		const ks = range && anchor ? rangeKeys(keys, anchor, k) : [k];
		for (const x of ks.length ? ks : [k]) {
			const item = items[keys.indexOf(x)];
			for (const y of item && childKeys && scopeOf(item) === 'unit' ? withDescendants(x, childKeys) : [x]) {
				if (on) selected.add(y);
				else selected.delete(y);
			}
		}
		anchor = k;
	}

	/** While selecting, a tap on the row ticks it instead of following a link inside it. */
	function rowClick(e: MouseEvent, k: string) {
		if (!selecting) return;
		const t = e.target as HTMLElement;
		// A click in a list nested inside this row belongs to that list.
		if (t.closest('li[data-row]') !== e.currentTarget || !t.closest('.head, .card')) return;
		if (t.closest('.pick, .pick-hit')) return;
		e.preventDefault();
		e.stopPropagation();
		toggle(k, e.shiftKey);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (drag && e.key === 'Escape') cancel();
	}}
/>

<ul
	id={uid}
	class="elist {klass}"
	data-mode={mode}
	data-density={density}
	class:grid={axis === 'grid'}
	class:block={layout === 'block'}
	class:editing
	class:selecting
	bind:this={list}
	aria-label={ariaLabel}
>
	{#each items as item, index (key(item))}
		{@const k = key(item)}
		{@const on = !!selected?.has(k)}
		{@const dragging = drag?.key === k}
		{@const ctx = { index, mode, editing, selecting, selected: on, dragging }}
		<li
			data-row
			data-key={k}
			class:dragging
			class:picked={selecting && on}
			class:drop-before={drag?.over === k && drag.pos === 'before'}
			class:drop-after={(drag?.over === k && drag.pos !== 'before') || (drag?.out && index === items.length - 1)}
			class:drop-target={drag?.over === k && drag.pos === 'inside'}
			class:holder={rowCard && holder?.(item)}
			data-select-scope={rowCard && holder?.(item) ? scopeOf(item) : null}
			class={itemClass?.(item)}
			style:--drop-depth={drag?.out ? -1 : drag?.pos === 'inside' ? 1 : null}
			style:--drag-x={dragging ? `${drag?.dx ?? 0}px` : null}
			style:--drag-y={dragging ? `${drag?.dy ?? 0}px` : null}
			onclickcapture={(e) => rowClick(e, k)}
			animate:flip={{ duration: axis === 'grid' || prefersReducedMotion.current ? 0 : 200 }}
		>
			{#snippet pick()}
				<input
					type="checkbox"
					class="pick"
					checked={on}
					aria-label="Select {nameOf(item)}"
					onclick={(e) => {
						e.stopPropagation();
						toggle(k, e.shiftKey);
					}}
				/>
			{/snippet}
			{#snippet grip()}
				<button
					type="button"
					class="handle"
					aria-label="Move {nameOf(item)}"
					aria-describedby="{uid}-hint"
					onpointerdown={(e) => start(e, k)}
					onpointermove={follow}
					onpointerup={end}
					onpointercancel={cancel}
					onlostpointercapture={end}
					onkeydown={(e) => keydown(e, k)}><span aria-hidden="true">⠿</span></button
				>
			{/snippet}
			{#snippet gripOf()}{@render grip()}{/snippet}
			{#if layout === 'bare'}
				{@render row(item, { ...ctx, grip: editing && onmove ? gripOf : undefined })}
			{:else if rowCard && layout !== 'block'}
			<div class="card" class:link={mode === 'use' && !!href?.(item)}>
				<div class="slot">
					{#if selecting && selected}<label class="pick-hit hit">{@render pick()}</label>
					{:else if editing && onmove}{@render grip()}{/if}
				</div>
				<div class="content">{@render row(item, ctx)}</div>
				{#if editing && onremove}
					<button type="button" class="quiet verb hit" aria-label="{removeOf(item)} {nameOf(item)}" onclick={() => onremove(item)}>{removeOf(item)}</button>
				{:else if mode === 'use' && actions}
					<div class="verb">{@render actions(item, ctx)}</div>
				{/if}
			</div>
			{:else if layout !== 'block' || editing || selecting}
			<div class="head">
				{#if selecting && selected}{@render pick()}{/if}
				{#if editing && onmove}{@render grip()}{/if}
				{#if layout === 'block'}
					<div class="title">{@render title?.(item, ctx)}</div>
				{:else}
					<div class="body">
						{@render row(item, ctx)}
					</div>
				{/if}
				{#if editing && onremove}
					<button type="button" class="small remove" aria-label="{removeOf(item)} {nameOf(item)}" onclick={() => onremove(item)}>{removeOf(item)}</button>
				{/if}
			</div>
			{/if}
			{#if layout === 'block'}
				<div class="body">
					{@render row(item, ctx)}
				</div>
			{/if}
			{#if children}
				{#if rowCard}
					{#if holder?.(item)}<div class="shelf">{@render children(item, ctx)}</div>{/if}
				{:else}{@render children(item, ctx)}{/if}
			{/if}
		</li>
	{:else}
		{#if empty}<li class="empty">{@render empty()}</li>{/if}
	{/each}
	{#if rowCard && onadd && (editing || (addInUse && mode === 'use'))}
		<li class="ghost">
			{#if naming === null}
				<button type="button" class="ghost-slot" onclick={() => (naming = '')}><span aria-hidden="true">+</span><span>{addLabel}</span></button>
			{:else}
				<div class="ghost-slot">
					<span aria-hidden="true">+</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="inline-text name"
						aria-label={addLabel}
						maxlength="120"
						autofocus
						bind:value={naming}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								add(true);
							} else if (e.key === 'Escape') {
								e.preventDefault();
								naming = null;
							}
						}}
						onblur={() => add(false)}
					/>
				</div>
			{/if}
		</li>
	{/if}
</ul>
{#if !rowCard && editing && onadd}
	<button type="button" class="small add" onclick={() => onadd()}>+ {addLabel}</button>
{/if}
{#if editing && onmove}
	<span id="{uid}-hint" class="sr-only"
		>Drag, or use the {axis === 'grid' ? '' : 'up and down '}arrow keys, to move.{canDrop && axis !== 'grid' ? ' The right arrow puts it inside the row above, where it fits.' : ''}{onoutdent
			? ' The left arrow takes it out of this list.'
			: ''}</span
	>
	<span class="sr-only" aria-live="polite">{announce}</span>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.head > .handle {
		margin-inline-start: 0;
	}
	.dragging > .head > .body {
		box-shadow: var(--shadow-lifted);
		border-radius: var(--radius-card);
	}
	/* Block layout: a framed item with a title bar. */
	.block.editing > li {
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		padding: 0.35rem 0.5rem 0.5rem;
		background: var(--bg, transparent);
	}
	.block > li > .head {
		min-height: 2rem;
		flex-wrap: wrap;
		row-gap: 0.3rem;
	}
	.block .title {
		flex: 1;
		min-width: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--muted);
	}
	.block.editing > li > .body:not(:empty) {
		margin-top: 0.4rem;
	}
	.block > li.dragging {
		box-shadow: var(--shadow-lifted);
		background: var(--surface-lifted);
	}
	.selecting > li {
		cursor: pointer;
	}
	.picked > .head > .body > :global(.card) {
		box-shadow: var(--chosen-shadow);
	}
	.remove {
		flex: none;
	}
	.add {
		margin-top: 0.5rem;
	}
	.empty {
		display: block;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
