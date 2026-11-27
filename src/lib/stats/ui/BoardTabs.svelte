<script lang="ts">
	// Stats' board tabs and the Boards ⋯ beside them. A tab opens its board. Dragging a tab moves its board (a mouse or
	// pen as soon as it moves; a finger after a press-and-hold, so a swipe that starts on a tab still scrolls), and so do
	// Alt and the left or right arrow on a focused tab, and Move… in the ⋯, which lists the places the board can go (the
	// one-pointer way, WCAG 2.5.7). Rename this board opens the tab's name as a box in place. Every move and rename posts
	// one band line with Undo. The drag works as EditableList's grip does, on the tab itself.
	import { goto, invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { showToast } from '$lib/toast.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import MenuButton, { menuFit, menuKeys, menuNudge, type Way } from '$lib/ui/MenuButton.svelte';
	import { gridDrop, moveKey, pressMoved } from '$lib/ui/list';
	import { statsOp, undoOp } from '../client';
	import { boardPlaces, keyMoved, movedSaid, type Named } from '../boards';

	let {
		boards,
		current,
		before = [],
		after = [],
		ondelete
	}: {
		boards: Named[];
		/** The board shown, whose tab is current and whose Rename, Move… and Delete the ⋯ holds. */
		current: string | null;
		/** The rest of the Boards ⋯: New board… before this board's own acts, Opens with after them. */
		before?: (Way | '-')[];
		after?: (Way | '-')[];
		ondelete: () => void;
	} = $props();

	const uid = $props.id();
	/** The tabs as shown: moved at once here, then refreshed from the server. */
	let shown = $derived(boards);
	const name = $derived(boards.find((b) => b.id === current)?.name ?? '');
	const places = $derived(current ? boardPlaces(shown, current) : []);
	let row = $state<HTMLElement>();
	let more = $state<HTMLElement>();
	const tabOf = (id: string) => row?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);

	async function op(body: Record<string, unknown>) {
		try {
			await statsOp(body);
			await invalidateAll();
			return true;
		} catch (e) {
			showToast((e as Error).message);
			return false;
		}
	}

	function pick(id: string) {
		statsOp({ op: 'last', id }).catch(() => {});
		goto(`?board=${id}`, { keepFocus: true, noScroll: true });
	}

	/** Put the boards in `order`, with its line in the band; a focused tab keeps the focus as it moves. */
	async function reorder(order: string[], id: string) {
		const was = shown;
		const ids = was.map((b) => b.id);
		if (order.join('\n') === ids.join('\n')) return;
		const focused = !!row && document.activeElement === tabOf(id);
		shown = order.map((x) => was.find((b) => b.id === x)!);
		if (focused) tick().then(() => tabOf(id)?.focus());
		// Stats without a board in its address opens the last board, else the first: a move must not change the board shown.
		if (current) await statsOp({ op: 'last', id: current }).catch(() => {});
		if (await op({ op: 'board.order', ids: order })) showToast(movedSaid(was, order, id), undoOp({ op: 'board.order', ids }));
		else shown = was;
	}

	// ----- Rename this board: the current tab becomes its name's box -----

	/** The tab holds the box; then the box opens, so InlineText takes the name and the focus. */
	let naming = $state(false);
	let nameOpen = $state(false);
	async function rename() {
		naming = true;
		await tick();
		nameOpen = true;
	}
	function named(open: boolean) {
		nameOpen = open;
		if (open) return;
		naming = false;
		const id = current;
		// Enter and Esc take the box and the focus with it: the focus goes back to the tab, not to the page.
		tick().then(() => {
			if (id && (!document.activeElement || document.activeElement === document.body)) tabOf(id)?.focus();
		});
	}
	async function saveName(v: string) {
		const id = current;
		const was = name;
		if (id && (await op({ op: 'board.patch', id, name: v }))) showToast(`Renamed “${was}” to “${v}”.`, undoOp({ op: 'board.patch', id, name: was }));
	}

	// ----- Move…: the places this board can go, in a menu under the ⋯ -----

	let placing = $state(false);
	let placeUp = $state(false);
	let placeRoom = $state(0);
	let placeNudge = $state(0);
	let placeEl = $state<HTMLElement>();
	const placeItems = () => [...(placeEl?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
	const trigger = () => more?.querySelector<HTMLElement>('button[aria-haspopup]');

	async function place() {
		placing = true;
		await tick();
		const t = trigger();
		if (!placeEl || !t) return;
		({ up: placeUp, room: placeRoom } = menuFit(t.getBoundingClientRect(), placeEl.scrollHeight));
		placeNudge = 0;
		await tick();
		if (!placeEl) return;
		placeNudge = menuNudge(placeEl.getBoundingClientRect(), 'end');
		placeItems()[0]?.focus();
	}
	function closePlace(refocus = true) {
		placing = false;
		if (refocus) trigger()?.focus();
	}

	const menu = $derived<(Way | '-')[]>([
		...before,
		...(current
			? [
					'-' as const,
					{ label: 'Rename this board', onselect: rename },
					...(places.length ? [{ label: 'Move…', onselect: place }] : []),
					{ label: 'Delete board', onselect: ondelete },
					...(after.length ? ['-' as const, ...after] : [])
				]
			: [])
	]);

	// ----- Dragging a tab -----

	// ponytail: fixed ms, as EditableList's; how long a finger holds a tab before it lifts.
	const HOLD_MS = 400;
	/** A press on a tab that hasn't lifted it yet: a tap, the start of a drag, or a finger holding it. */
	let press: { id: string; x: number; y: number; hold: boolean; timer: number } | null = null;
	let drag = $state<{ id: string; x: number; y: number; dx: number; dy: number; over: string | null; pos: 'before' | 'after' | null } | null>(null);
	/** The click a drag (or a swipe) ends with isn't a tap, so it opens no board. */
	let swallow = false;

	function down(e: PointerEvent, id: string) {
		if (e.button !== 0) return;
		swallow = false;
		const hold = e.pointerType !== 'mouse' && matchMedia('(pointer: coarse)').matches;
		if (!hold) e.preventDefault(); // no text selection while a mouse drags
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		release();
		press = { id, x: e.clientX, y: e.clientY, hold, timer: hold ? window.setTimeout(lift, HOLD_MS) : 0 };
	}

	function moved(e: PointerEvent) {
		if (drag) return follow(e);
		const now = press && pressMoved(e.clientX - press.x, e.clientY - press.y, press.hold);
		if (!now || now === 'stay') return;
		if (now === 'scroll') {
			swallow = true;
			return release();
		}
		lift();
		follow(e);
	}

	function lift() {
		if (!press) return;
		const p = press;
		release();
		drag = { id: p.id, x: p.x, y: p.y, dx: 0, dy: 0, over: null, pos: null };
		window.getSelection()?.removeAllRanges();
		document.documentElement.classList.add('el-dragging');
	}

	function release() {
		if (press) clearTimeout(press.timer);
		press = null;
	}

	/** The held tab follows the pointer; the line shows the gap it would land in, where that moves it. */
	function follow(e: PointerEvent) {
		if (!drag || !row) return;
		const d = drag;
		d.dx = e.clientX - d.x;
		d.dy = e.clientY - d.y;
		const cells = [...row.querySelectorAll<HTMLElement>('[data-id]')].filter((t) => t.dataset.id !== d.id).map((t) => ({ key: t.dataset.id!, box: t.getBoundingClientRect() }));
		const hit = gridDrop(e.clientX, e.clientY, cells, row.getBoundingClientRect().width);
		const ids = shown.map((b) => b.id);
		const lands = !!hit && moveKey(ids, d.id, hit.key, hit.position).join('\n') !== ids.join('\n');
		d.over = lands ? hit.key : null;
		d.pos = lands ? hit.position : null;
	}

	function stop() {
		drag = null;
		document.documentElement.classList.remove('el-dragging');
	}

	function up() {
		release();
		if (!drag) return;
		const d = drag;
		swallow = true;
		stop();
		if (d.over && d.pos) reorder(moveKey(shown.map((b) => b.id), d.id, d.over, d.pos), d.id);
	}

	function cancel() {
		if (drag) swallow = true;
		release();
		stop();
	}

	// Tabs that go mid-press or mid-drag take the timer and the page's dragging class with them.
	$effect(() => () => {
		release();
		stop();
	});

	/** While a tab is held a finger drags it instead of scrolling the page. Svelte adds touchmove passive, so this is added by hand. */
	function heldScroll(el: Element) {
		const stay = (e: Event) => {
			if (drag) e.preventDefault();
		};
		el.addEventListener('touchmove', stay, { passive: false });
		return () => el.removeEventListener('touchmove', stay);
	}

	/** A tap opens the board; the click a drag ends with doesn't. A click from the keyboard (detail 0) always counts. */
	function open(e: MouseEvent, id: string) {
		e.preventDefault();
		if (swallow && e.detail > 0) {
			swallow = false;
			return;
		}
		pick(id);
	}

	/** Alt and the left or right arrow move the board one place, the way the tabs read. */
	function keydown(e: KeyboardEvent, id: string) {
		const order = keyMoved(shown.map((b) => b.id), id, e, !!row && getComputedStyle(row).direction === 'rtl');
		if (!order) return;
		e.preventDefault();
		reorder(order, id);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (drag && e.key === 'Escape') cancel();
	}}
	onpointerdown={(e) => {
		// Anywhere but the Move menu closes it, the ⋯ too, so the Boards menu never opens over it.
		if (placing && !placeEl?.contains(e.target as Node)) closePlace(false);
	}}
/>

<nav class="subtabs boards" aria-label="Boards">
	<div class="subtabs-row" bind:this={row} {@attach heldScroll}>
		{#each shown as b (b.id)}
			{#if naming && b.id === current}
				<span class="tab" aria-current="page"><InlineText value={b.name} bind:open={() => nameOpen, named} label="Name of this board" maxlength={40} onsave={saveName} /></span>
			{:else}
				{@const held = drag?.id === b.id}
				<a
					class="tab"
					class:held
					href="?board={b.id}"
					data-id={b.id}
					data-reserve={b.name}
					draggable="false"
					aria-current={b.id === current ? 'page' : undefined}
					aria-describedby="{uid}-hint"
					style:--drag-x={held ? `${drag?.dx ?? 0}px` : null}
					style:--drag-y={held ? `${drag?.dy ?? 0}px` : null}
					onclick={(e) => open(e, b.id)}
					onpointerdown={(e) => down(e, b.id)}
					onpointermove={moved}
					onpointerup={up}
					onpointercancel={cancel}
					onlostpointercapture={up}
					oncontextmenu={(e) => {
						if (drag || press?.hold) e.preventDefault();
					}}
					onkeydown={(e) => keydown(e, b.id)}
					>{b.name}{#if drag?.over === b.id}<span class="drop {drag.pos}" aria-hidden="true"></span>{/if}</a
				>
			{/if}
		{/each}
	</div>
	<span class="board-more" bind:this={more}>
		<MenuButton class="quiet glyph" label="More on boards" menuLabel="Boards" items={menu} />
		{#if placing}
			<div
				class="menu"
				role="menu"
				tabindex="-1"
				aria-label="Move {name}"
				data-side={placeUp ? 'up' : null}
				style:--menu-room="{placeRoom}px"
				style:--menu-nudge="{placeNudge}px"
				bind:this={placeEl}
				onkeydown={(e) => menuKeys(e, placeItems(), closePlace)}
			>
				{#each places as p, i (i)}
					<button type="button" role="menuitem" tabindex="-1" onclick={() => (closePlace(), current && reorder(p.order, current))}><span class="menu-label">{p.label}</span></button>
				{/each}
			</div>
		{/if}
	</span>
</nav>
<span id="{uid}-hint" class="vh">Drag it to move this board, or press Alt with the left or right arrow.</span>

<style>
	.boards {
		justify-content: space-between;
		margin-block-end: var(--space-inline);
	}
	.boards .subtabs-row {
		flex-wrap: wrap;
	}
	.board-more {
		position: relative;
	}
	/* A long press on a tab lifts it: no callout or text selection on the way. */
	a.tab {
		-webkit-touch-callout: none;
		-webkit-user-select: none;
		user-select: none;
	}
	/* The held tab: lifted, following the pointer; its place stays open, as a held grid card's does. */
	.tab.held {
		z-index: var(--z-raised);
		translate: var(--drag-x) var(--drag-y);
		color: var(--ink);
		background: var(--surface-lifted);
		outline: 1px solid var(--line-control);
		border-radius: var(--radius-inset);
		box-shadow: var(--shadow-lifted);
	}
	/* The drop line: the accent line DragHandle draws in a grid's gap, standing between two tabs. The tab's own ::before
	   and ::after are its bar and its reserve, so the line is a span of its own. */
	.drop {
		position: absolute;
		z-index: var(--z-drop);
		inset-block: 0;
		margin-block: auto;
		inline-size: var(--drop-line);
		block-size: var(--control-sm);
		border-radius: var(--radius-indicator);
		background: var(--accent);
		pointer-events: none;
	}
	.drop.before {
		inset-inline-start: calc(var(--drop-line) / -2);
	}
	.drop.after {
		inset-inline-end: calc(var(--drop-line) / -2);
	}
	@media (forced-colors: active) {
		.drop {
			forced-color-adjust: none;
			background: Highlight;
		}
		.tab.held {
			outline-color: CanvasText;
		}
	}
</style>
