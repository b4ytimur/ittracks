<script lang="ts" generics="T">
	// The one list every list of rows in the app is built from. A list has no mode: what a row offers
	// follows from what the page passes, so the list a page shows is the list it changes.
	//
	// The grip, on each row whenever there is `onmove` (and the list isn't selecting): drag it (a mouse or pen as soon as
	// it moves; a finger after a press-and-hold, so a swipe that starts on it still scrolls the page); the arrow keys on it move one
	// place; a tap, Enter or Space opens the Move menu, the one-pointer way (WCAG 2.5.7): Move up, Move down,
	// Put inside {the row above}, Take out of {the row holding the list}, only those that can happen here.
	// Every way ends in the same onmove, so the page says each move once, with its Undo.
	// `selecting`: a labelled checkbox on each row, and a tap anywhere on the row ticks it instead of
	// following its link. Shift-click ticks a range. Several lists on one page can share one `selected`
	// set (pass a SvelteSet); a list only adds and removes its own keys.
	// `onremove` puts a remove verb on each row, `onadd` an add slot at the end (a name field in place).
	//
	// The list knows nothing about what a row is: the page renders it with `row` and gets moves back as
	// keys (see list.ts). Drops inside a row only happen where `canDrop` allows them. A row that leaves
	// with the focus in it hands the focus to the row taking its place, never to the page.
	//
	// Nesting, the outliner way: a row's `children` can hold another EditableList. While a row is
	// held, height picks the gap and sideways travel the depth: toward the end puts it inside the row
	// above the gap (as the right arrow does), toward the start takes it out of a nested list, to just
	// after the row holding it (`onoutdent`, as the left arrow does).
	import { tick, type Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import { menuFit, menuKeys, menuNudge } from './MenuButton.svelte';
	import { applyMove, dropDepth, dropPosition, gridDrop, moveChoices, nearest, pressMoved, rangeKeys, refocusAt, withDescendants, type Move, type MoveChoice, type Position, type RowContext } from './list';

	let {
		items,
		key,
		label,
		selecting = false,
		selected,
		selectScope = 'item',
		childKeys,
		canDrop,
		onmove,
		onoutdent,
		outOf = '',
		onremove,
		removeLabel = 'Remove',
		onadd,
		addLabel = 'Add',
		slotOpen = false,
		row,
		rowCard = false,
		href,
		holder,
		actions,
		density = 'regular',
		title,
		layout,
		axis = 'y',
		itemClass,
		children,
		ariaLabel,
		class: klass = ''
	}: {
		items: T[];
		/** A stable, unique key per item. */
		key: (item: T) => string;
		/** The item's name for screen readers ("Move Gym", "Select Gym"). Defaults to the key. */
		label?: (item: T) => string;
		/** A checkbox on each row; a tap on the row ticks it. Wins over the grip where both would show. */
		selecting?: boolean;
		/** Ticked keys, owned by the page. Pass a SvelteSet so rows update when it changes. */
		selected?: Set<string>;
		/** Ticking a row ticks what is inside it too ("unit"; needs `childKeys`), or the row alone ("item"). */
		selectScope?: 'unit' | 'item' | ((item: T) => 'unit' | 'item');
		/** The keys inside a row, for "unit". */
		childKeys?: (key: string) => string[];
		/** Whether a move is allowed. Without it, rows can go before and after each other, never inside. */
		canDrop?: (move: Move) => boolean;
		/**
		 * Rows can be moved: a grip on each. `order` is this list's keys afterwards (without the key, for a move
		 * inside a row), `text` says it. A page that puts `text` in the band returns true: the band speaks it then, once.
		 */
		onmove?: (move: Move, order: string[], text: string) => unknown;
		/** In a list nested inside a row: the row with this key moves out, to just after the row holding the list. */
		onoutdent?: (key: string) => void;
		/** With onoutdent: the name of the row holding the list, for the Move menu's "Take out of {name}". */
		outOf?: string;
		/** A remove verb on each row. */
		onremove?: (item: T) => void;
		/** The remove verb's word: Remove, Archive, Hide... or one per item. */
		removeLabel?: string | ((item: T) => string);
		/** Adds to the list. With `rowCard`, a dashed slot at the end of the list takes the new one's name. */
		onadd?: (name?: string) => void;
		addLabel?: string;
		/** With `rowCard`: the slot stays open with nothing in it, so names keep the column of grips nearby. */
		slotOpen?: boolean;
		row: Snippet<[T, RowContext]>;
		/** The list draws the card: the grip and the verb sit inside it, and `row` renders its content only. */
		rowCard?: boolean;
		/** With `rowCard`: the whole card follows this link (a stretched link on `a.name` in the row), except while selecting. */
		href?: (item: T) => string | undefined;
		/** With `rowCard`: this row holds others, so it and its `children` draw as one unit. */
		holder?: (item: T) => boolean;
		/** With `rowCard`: what stands at the end of the row when it has no remove verb. */
		actions?: Snippet<[T, RowContext]>;
		density?: 'regular' | 'compact';
		/** With layout "block": the title in the bar above the row, beside the grip and remove verb. */
		title?: Snippet<[T, RowContext]>;
		/**
		 * "block": a framed item with a bar (grip, title, remove verb) above the row at full width,
		 * for big items such as a phase that holds fields of its own.
		 * "bare": `row` draws all of it and puts the grip (`ctx.grip`) where it belongs.
		 */
		layout?: 'block' | 'bare';
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
		ariaLabel?: string;
		class?: string;
	} = $props();

	/** A grip on each row: there is onmove, and the list isn't selecting (the checkbox takes the slot then). */
	const grips = $derived(!!onmove && !selecting);
	const scopeOf = (item: T) => (typeof selectScope === 'function' ? selectScope(item) : selectScope);
	const nameOf = (item: T) => label?.(item) ?? key(item);
	const removeOf = (item: T) => (typeof removeLabel === 'function' ? removeLabel(item) : removeLabel);
	const keys = $derived(items.map(key));
	const uid = $props.id();

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
		const text = m.position === 'inside' ? `Moved ${nameOf(item)} into ${target ? nameOf(target) : 'the row'}.` : `Moved ${nameOf(item)} to ${order.indexOf(m.key) + 1} of ${order.length}.`;
		if (onmove?.(m, order, text) !== true) announce = text;
		if (refocus) await focusHandle(m.key);
	}

	async function outdent(k: string, refocus: boolean) {
		const item = items[keys.indexOf(k)];
		onoutdent?.(k);
		announce = `${nameOf(item)} moved out, after the row that held it.`;
		if (refocus) await focusHandle(k);
	}

	/** Moving a row can take the focus off its grip, or the row to another list: put it back. */
	async function focusHandle(k: string) {
		await tick();
		const li = `li[data-key="${CSS.escape(k)}"]`;
		// A row's own grip comes before any in what it holds.
		const find = (from: string) => document.querySelector<HTMLElement>(`${from}${li} .handle`);
		(find(`#${CSS.escape(uid)} > `) ?? find(''))?.focus();
	}

	// ----- The Move menu -----

	let menuFor = $state<string | null>(null);
	let menuUp = $state(false);
	let menuRoom = $state(0);
	let menuNudgeBy = $state(0);
	let menuEl = $state<HTMLElement>();
	let menuGrip: HTMLElement | null = null;
	const choicesOf = (k: string) => moveChoices(keys, k, { allowed, nameOf: (x) => nameOf(items[keys.indexOf(x)]), outOf: onoutdent ? outOf : undefined, grid: axis === 'grid' });
	const menuItems = () => [...(menuEl?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];

	async function openMenu(k: string, grip: HTMLElement) {
		if (!choicesOf(k).length) {
			announce = `${nameOf(items[keys.indexOf(k)])} has nowhere to move here.`;
			return;
		}
		menuFor = k;
		menuGrip = grip;
		menuRoom = 0;
		await tick();
		if (!menuEl) return;
		// It hangs from the card (or the block's bar) it follows, or in a bare row from the grip's own wrapper.
		const from = (menuEl.parentElement?.classList.contains('move-at') ? menuEl.parentElement : menuEl.previousElementSibling) ?? grip;
		({ up: menuUp, room: menuRoom } = menuFit(from.getBoundingClientRect(), menuEl.scrollHeight));
		menuNudgeBy = 0;
		await tick();
		if (!menuEl) return;
		menuNudgeBy = menuNudge(menuEl.getBoundingClientRect(), 'start');
		menuItems()[0]?.focus();
	}

	function closeMenu(refocus = true) {
		menuFor = null;
		if (refocus) menuGrip?.focus();
	}

	function choose(k: string, c: MoveChoice) {
		menuFor = null;
		if (c.move === 'out') outdent(k, true);
		else commit(c.move, true);
	}

	// ----- Dragging -----

	// ponytail: fixed ms, not a token; how long a finger holds the grip before its row lifts.
	const HOLD_MS = 400;

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
		/** Held far enough toward the start of a nested list to leave it. */
		out: boolean;
	} | null>(null);
	/** A press on a grip that hasn't lifted its row yet: a tap, the start of a drag, or a finger holding it. */
	let press: { key: string; x: number; y: number; hold: boolean; timer: number } | null = null;
	/** The click a drag (or a swipe) ends with isn't a tap, so it opens no menu. */
	let swallow = false;
	let raf = 0;

	const rows = () => (list ? Array.from(list.querySelectorAll<HTMLElement>(':scope > li[data-row]')) : []);

	function down(e: PointerEvent, k: string) {
		if (e.button !== 0 || !grips) return;
		swallow = false;
		// A finger on a touch screen holds to lift; until then the page scrolls (touch-action pan-y, DragHandle).
		const hold = e.pointerType !== 'mouse' && matchMedia('(pointer: coarse)').matches;
		if (!hold) e.preventDefault(); // no text selection while a mouse drags
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		release();
		press = { key: k, x: e.clientX, y: e.clientY, hold, timer: hold ? window.setTimeout(lift, HOLD_MS) : 0 };
	}

	function moved(e: PointerEvent) {
		if (drag) return follow(e);
		const now = press && pressMoved(e.clientX - press.x, e.clientY - press.y, press.hold);
		if (!now || now === 'stay') return;
		if (now === 'scroll') {
			// A swipe, not a hold: the page scrolls, and the click it may end with is no tap.
			swallow = true;
			return release();
		}
		lift();
		follow(e);
	}

	/** The press becomes a drag: the row lifts where the press began. */
	function lift() {
		if (!press) return;
		const p = press;
		release();
		menuFor = null;
		drag = { key: p.key, startX: p.x, startY: p.y, startScroll: window.scrollY, x: p.x, y: p.y, dx: 0, dy: 0, over: null, pos: null, out: false };
		// No text gets selected while a row is held.
		window.getSelection()?.removeAllRanges();
		document.documentElement.classList.add('el-dragging');
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(scrollStep);
	}

	function release() {
		if (press) clearTimeout(press.timer);
		press = null;
	}

	// A list that goes mid-press or mid-drag takes its timer, its frame loop and the page's dragging class with it.
	$effect(() => () => {
		release();
		stop();
	});

	/** While a row is held a finger drags it instead of scrolling the page. Svelte adds touchmove passive, so this is added by hand. */
	function heldScroll(el: Element) {
		const stay = (e: Event) => {
			if (drag) e.preventDefault();
		};
		el.addEventListener('touchmove', stay, { passive: false });
		return () => el.removeEventListener('touchmove', stay);
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
		// Height picks the gap, sideways travel how deep the row joins there; a finger needs twice as much.
		const indent = parseFloat(getComputedStyle(document.documentElement).fontSize);
		const rtl = !!list && getComputedStyle(list).direction === 'rtl';
		const depth = (max: number) => dropDepth(d.x - d.startX, matchMedia('(pointer: coarse)').matches ? 2 * indent : indent, onoutdent ? -1 : 0, max, rtl);
		d.dx = axis === 'grid' ? d.x - d.startX : 0;
		d.out = axis === 'y' && depth(0) < 0;
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
			const head = (layout ? r : (r.querySelector(':scope > .card') ?? r)).getBoundingClientRect();
			const gap = dropPosition(d.y, head);
			const above = gap === 'after' ? r : others[others.indexOf(r) - 1];
			const into = above && { key: d.key, target: above.dataset.key!, position: 'inside' as const };
			const m: Move = into && depth(allowed(into) ? 1 : 0) === 1 ? into : { key: d.key, target: r.dataset.key!, position: gap };
			if (allowed(m) && changes(m)) [over, pos] = [m.target, m.position];
			// On a shelf the held row steps with the line; at the top both depths start at one column.
			if (pos === 'inside' && onoutdent) d.dx = rtl ? -indent : indent;
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

	/** The pointer is up (or let go): a held row drops; a press that never lifted was a tap, and its click opens the menu. */
	function up() {
		release();
		if (!drag) return;
		const d = drag;
		swallow = true;
		stop();
		if (d.out) outdent(d.key, false);
		else if (d.over && d.pos) commit({ key: d.key, target: d.over, position: d.pos }, false);
	}

	function cancel() {
		if (drag) swallow = true;
		release();
		stop();
	}

	/** A tap, Enter or Space on the grip: the Move menu. A click from the keyboard (detail 0) always counts. */
	function tap(e: MouseEvent, k: string) {
		if (swallow && e.detail > 0) {
			swallow = false;
			return;
		}
		if (menuFor === k) closeMenu();
		else openMenu(k, e.currentTarget as HTMLElement);
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

	// ----- Focus when a row leaves -----

	// A row removed, archived away or moved into another takes its focused control with it, and the focus
	// would fall to the page. Before the list redraws, note where it was; after, give it to the control of the
	// same kind in the row now at that index (refocusAt), or the last row, or the add slot.
	const FOCUSABLE = 'button:not([tabindex="-1"]), a[href], input:not([type="hidden"]), select, textarea, [tabindex="0"]';
	/** A row's own controls, in order: not those of rows nested in it, nor of an open menu. */
	const controls = (r: Element) => [...r.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((c) => c.closest('li[data-row]') === r && !c.closest('.menu'));
	/** A control's kind, to find its like in the next row: a Delete for a Delete, a grip for a grip. */
	const kindOf = (c: Element) => `${c.tagName}.${c.className}`;
	let leaving: { key: string; index: number; at: number; kinds: string[] } | null = null;
	$effect.pre(() => {
		void keys;
		const el = document.activeElement;
		const rs = rows();
		const r = el ? rs.find((x) => x.contains(el)) : undefined;
		leaving = r ? { key: r.dataset.key!, index: rs.indexOf(r), at: controls(r).indexOf(el as HTMLElement), kinds: controls(r).map(kindOf) } : null;
	});
	$effect(() => {
		void keys;
		const was = leaving;
		leaving = null;
		if (!was) return;
		const now = document.activeElement;
		if (now && now !== document.body && now.isConnected) return;
		const rs = rows();
		// A row that only moved drops its focus as its node moves, too: when the order comes back from the server (the
		// Log's plan), after focusHandle has run. It gets it back on the same control.
		const same = rs.find((r) => r.dataset.key === was.key);
		if (same) return void controls(same)[was.at]?.focus();
		const next = rs[nearest(was.index, rs.length)];
		const cs = next ? controls(next) : [];
		(cs[refocusAt(was.kinds, was.at, cs.map(kindOf))] ?? ghostSlot())?.focus();
	});
	const ghostSlot = () => list?.querySelector<HTMLElement>(':scope > .ghost > .ghost-slot');

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

	// ----- Adding: the dashed slot at the end, a button until pressed, then a name field in the same box -----

	/** Enter adds and stays open for the next name; Escape closes; leaving the field adds what was typed. */
	let naming = $state<string | null>(null);
	function addNamed(again: boolean) {
		const name = naming?.trim();
		naming = again && name ? '' : null;
		if (name) onadd?.(name);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (drag && e.key === 'Escape') cancel();
	}}
	onpointerdown={(e) => {
		if (menuFor !== null && !menuEl?.contains(e.target as Node) && !menuGrip?.contains(e.target as Node)) closeMenu(false);
	}}
/>

<ul
	id={uid}
	class="elist {klass}"
	data-density={density}
	class:grid={axis === 'grid'}
	class:block={layout === 'block'}
	class:grips
	class:selecting
	class:slotted={grips || selecting || slotOpen}
	bind:this={list}
	aria-label={ariaLabel}
>
	{#each items as item, index (key(item))}
		{@const k = key(item)}
		{@const on = !!selected?.has(k)}
		{@const dragging = drag?.key === k}
		{@const ctx = { index, selecting, selected: on, dragging }}
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
					aria-haspopup={choicesOf(k).length ? 'menu' : undefined}
					aria-expanded={choicesOf(k).length ? menuFor === k : undefined}
					onpointerdown={(e) => down(e, k)}
					onpointermove={moved}
					onpointerup={up}
					onpointercancel={cancel}
					onlostpointercapture={up}
					onclick={(e) => tap(e, k)}
					oncontextmenu={(e) => e.preventDefault()}
					onkeydown={(e) => keydown(e, k)}
					{@attach heldScroll}><span aria-hidden="true">⠿</span></button
				>
			{/snippet}
			{#snippet menu()}
				{#if grips && menuFor === k}
					<span
						class="menu {layout === 'bare' ? 'start' : 'move-menu'}"
						role="menu"
						tabindex="-1"
						aria-label="Move {nameOf(item)}"
						data-side={menuUp ? 'up' : null}
						style:--menu-room="{menuRoom}px"
						style:--menu-nudge="{menuNudgeBy}px"
						bind:this={menuEl}
						onkeydown={(e) => menuKeys(e, menuItems(), closeMenu)}
					>
						{#each choicesOf(k) as c (c.label)}
							<button type="button" role="menuitem" tabindex="-1" onclick={() => choose(k, c)}><span class="menu-label">{c.label}</span></button>
						{/each}
					</span>
				{/if}
			{/snippet}
			{#snippet moveAt()}<span class="move-at">{@render grip()}{@render menu()}</span>{/snippet}
			{#if layout === 'bare'}
				{@render row(item, { ...ctx, grip: grips ? moveAt : undefined })}
			{:else if rowCard && layout !== 'block'}
				<div class="card" class:link={!selecting && !!href?.(item)}>
					<div class="slot">
						{#if selecting && selected}<label class="pick-hit hit">{@render pick()}</label>
						{:else if grips}{@render grip()}{/if}
					</div>
					<div class="content">{@render row(item, ctx)}</div>
					{#if onremove && !selecting}
						<button type="button" class="quiet verb" aria-label="{removeOf(item)} {nameOf(item)}" onclick={() => onremove(item)}>{removeOf(item)}</button>
					{:else if actions && !selecting}
						<div class="verb">{@render actions(item, ctx)}</div>
					{/if}
				</div>
				{@render menu()}
			{:else}
				<div class="head">
					{#if selecting && selected}{@render pick()}
					{:else if grips}{@render grip()}{/if}
					<div class="title">{@render title?.(item, ctx)}</div>
					{#if onremove && !selecting}
						<button type="button" class="quiet remove" aria-label="{removeOf(item)} {nameOf(item)}" onclick={() => onremove(item)}>{removeOf(item)}</button>
					{/if}
				</div>
				{@render menu()}
			{/if}
			{#if layout === 'block'}
				<div class="block-body">
					{@render row(item, ctx)}
				</div>
			{/if}
			{#if children}
				{#if rowCard}
					{#if holder?.(item)}<div class="shelf">{@render children(item, ctx)}</div>{/if}
				{:else}{@render children(item, ctx)}{/if}
			{/if}
		</li>
	{/each}
	{#if rowCard && onadd && !selecting}
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
								addNamed(true);
							} else if (e.key === 'Escape') {
								e.preventDefault();
								naming = null;
								tick().then(() => ghostSlot()?.focus()); // back on the slot, never on the page
							}
						}}
						onblur={() => addNamed(false)}
					/>
				</div>
			{/if}
		</li>
	{/if}
</ul>
{#if !rowCard && onadd && !selecting}
	<button type="button" class="add" onclick={() => onadd()}>+ {addLabel}</button>
{/if}
{#if grips}
	<span id="{uid}-hint" class="vh"
		>Press to choose a move, drag, or use the {axis === 'grid' ? '' : 'up and down '}arrow keys.{canDrop && axis !== 'grid' ? ' The right arrow puts it inside the row above, where it fits.' : ''}{onoutdent
			? ' The left arrow takes it out of this list.'
			: ''}</span
	>
	<span class="vh" aria-live="polite">{announce}</span>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-inline);
	}
	.block-body {
		flex: 1;
		min-width: 0;
	}
	.head > .handle {
		margin-inline-start: 0;
	}
	/* Block layout: a framed item with a title bar. */
	.block > li {
		border: 1px dashed var(--line);
		border-radius: var(--radius-card);
		padding: var(--space-inline);
	}
	.block > li > .head {
		min-height: var(--control-md);
		flex-wrap: wrap;
		row-gap: var(--space-tight);
	}
	.block .title {
		flex: 1;
		min-width: 0;
		font-size: var(--font-size-meta);
		font-weight: 600;
		color: var(--ink-muted);
	}
	.block > li > .block-body:not(:empty) {
		margin-top: var(--space-inline);
	}
	.block > li.dragging {
		box-shadow: var(--shadow-lifted);
		background: var(--surface-lifted);
	}
	.selecting > li {
		cursor: pointer;
	}
	.remove {
		flex: none;
	}
	.add {
		margin-top: var(--space-inline);
	}
</style>
