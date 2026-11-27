// The logic behind the shared list (EditableList.svelte), kept pure so it can be tested without a
// browser: where a drop lands, what order a move gives, what the Move menu offers, and range selection.
// Lists work on keys (strings), never on the items themselves, so any kind of row fits.

import type { Snippet } from 'svelte';

/** A page's mode, the switch in its title line (EditChrome). A list takes no mode: see EditableList. */
export type Mode = 'use' | 'edit' | 'select';

/** What a list tells each row it renders. */
export interface RowContext {
	index: number;
	selecting: boolean;
	selected: boolean;
	dragging: boolean;
	/** The grip (only when the list has onmove and isn't selecting), for a "bare" row to put where it belongs. */
	grip?: Snippet;
}

/** Where a dragged row lands relative to the row it is dropped on. */
export type Position = 'before' | 'after' | 'inside';

/** One move: put `key` before, after or inside `target`. */
export interface Move {
	key: string;
	target: string;
	position: Position;
}

/** The gap for a pointer at `y` over a row: its upper half is the gap before it. */
export const dropPosition = (y: number, rect: { top: number; height: number }): 'before' | 'after' => ((rect.height > 0 ? (y - rect.top) / rect.height : 0.5) < 0.5 ? 'before' : 'after');

/**
 * How deep a held row joins: its sideways travel in whole steps from where the drag began, kept to
 * what the gap offers. 1 is inside the row above it, 0 among its own rows, -1 out of what holds it.
 */
export const dropDepth = (dx: number, step: number, min: number, max: number, rtl = false): number => Math.min(max, Math.max(min, Math.round((rtl ? -dx : dx) / step) || 0));

/** A row's key and every key inside it, however deep (for ticking a holder as one). */
export function withDescendants(key: string, childrenOf: (key: string) => string[]): string[] {
	return [key, ...childrenOf(key).flatMap((k) => withDescendants(k, childrenOf))];
}

/** The order after putting `key` right before or after `target`. Unknown keys change nothing. */
export function moveKey(keys: string[], key: string, target: string, position: 'before' | 'after'): string[] {
	if (key === target || !keys.includes(key) || !keys.includes(target)) return keys;
	const rest = keys.filter((k) => k !== key);
	const at = rest.indexOf(target) + (position === 'after' ? 1 : 0);
	return [...rest.slice(0, at), key, ...rest.slice(at)];
}

/** The order after moving `key` up (negative) or down (positive) by some places, kept in bounds. */
export function moveBy(keys: string[], key: string, by: number): string[] {
	const from = keys.indexOf(key);
	if (from < 0 || by === 0) return keys;
	const to = Math.max(0, Math.min(keys.length - 1, from + by));
	if (to === from) return keys;
	const rest = keys.filter((k) => k !== key);
	return [...rest.slice(0, to), key, ...rest.slice(to)];
}

/** One thing the Move menu offers: a move to send through onmove, or "out" for the list's onoutdent. */
export interface MoveChoice {
	label: string;
	move: Move | 'out';
}

/**
 * What the Move menu offers a row, the one-pointer way to move it (WCAG 2.5.7): the moves the arrow keys
 * make, by name, and none that can't happen here. `allowed` is the list's rule (canDrop); `outOf` names the
 * row holding this list, when the list can hand a row out to it (onoutdent: "" when it has no name); a grid
 * moves one place earlier or later, never inside.
 */
export function moveChoices(keys: string[], key: string, o: { allowed: (m: Move) => boolean; nameOf: (key: string) => string; outOf?: string; grid?: boolean }): MoveChoice[] {
	const i = keys.indexOf(key);
	if (i < 0) return [];
	const above = i > 0 ? keys[i - 1] : null;
	const below = i < keys.length - 1 ? keys[i + 1] : null;
	const moves: [string, Move][] = [];
	if (above !== null) moves.push([o.grid ? 'Move earlier' : 'Move up', { key, target: above, position: 'before' }]);
	if (below !== null) moves.push([o.grid ? 'Move later' : 'Move down', { key, target: below, position: 'after' }]);
	if (above !== null && !o.grid) moves.push([`Put inside ${o.nameOf(above)}`, { key, target: above, position: 'inside' }]);
	const out: MoveChoice[] = moves.filter(([, m]) => o.allowed(m)).map(([label, move]) => ({ label, move }));
	if (o.outOf !== undefined) out.push({ label: o.outOf ? `Take out of ${o.outOf}` : 'Take out', move: 'out' });
	return out;
}

/**
 * A press on a grip that has moved (dx, dy) but not lifted its row: still a tap ("stay"), a drag ("lift": a
 * mouse or pen lifts on moving), or a swipe ("scroll": a finger, `hold`, lifts only by holding still, so moving
 * first lets the page scroll). A finger wanders more than a mouse before a press stops being a tap.
 */
export function pressMoved(dx: number, dy: number, hold: boolean): 'stay' | 'lift' | 'scroll' {
	// ponytail: fixed px, not tokens; they measure a hand, not the layout.
	if (Math.hypot(dx, dy) <= (hold ? 10 : 4)) return 'stay';
	return hold ? 'scroll' : 'lift';
}

/** The place nearest `i` among `n` (the last when `i` is past them), or -1 when there are none: where the focus goes when its row leaves. */
export function nearest(i: number, n: number): number {
	return n ? Math.max(0, Math.min(i, n - 1)) : -1;
}

/**
 * Where the focus goes in the row taking a leaving row's place, from each row's controls by kind and the place `at` of
 * the focused one: the control of its kind, counted the same way (a Delete for a Delete, even past a different number
 * of links), else the one in the same place. -1 when the row has none.
 */
export function refocusAt(from: string[], at: number, to: string[]): number {
	const kind = from[at];
	const same = to.flatMap((k, i) => (k === kind ? [i] : []));
	return same.length ? same[nearest(from.slice(0, at).filter((k) => k === kind).length, same.length)] : nearest(at, to.length);
}

/** The order a move gives in one list. A move inside another row takes the key out of this list. */
export function applyMove(keys: string[], m: Move): string[] {
	if (m.position === 'inside') return keys.filter((k) => k !== m.key);
	return moveKey(keys, m.key, m.target, m.position);
}

/**
 * Put a reordered part of a longer order back into it. The part keeps the places it held, in
 * its new order, and everything else stays where it was. This is how a list showing a filtered
 * or grouped slice (one Area, one section) changes one shared order without disturbing the rest.
 * Keys in the part that the full order doesn't have yet are added at the end.
 */
export function mergeOrder(full: string[], part: string[]): string[] {
	const inPart = new Set(part);
	const missing = part.filter((k) => !full.includes(k));
	const base = [...full, ...missing];
	const queue = [...part];
	return base.map((k) => (inPart.has(k) ? queue.shift()! : k));
}

/** The keys from `from` to `to`, both included, in list order (for shift-click). */
export function rangeKeys(keys: string[], from: string, to: string): string[] {
	const a = keys.indexOf(from);
	const b = keys.indexOf(to);
	if (a < 0 || b < 0) return b < 0 ? [] : [to];
	return keys.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** How many of a list's keys are selected: none, some or all (for a "select all" box). */
export function selectionState(keys: string[], selected: { has(k: string): boolean }): 'none' | 'some' | 'all' {
	const n = keys.filter((k) => selected.has(k)).length;
	return n === 0 ? 'none' : n === keys.length ? 'all' : 'some';
}

/**
 * The shared order after one visible list was reordered. `order` is every item in the shared
 * order, `shown` what the page shows now in its order, `part` the reordered list's keys. When
 * the page is sorted some other way, what you see becomes the starting point, so the result
 * looks like the list you dragged in.
 */
export function reorderFrom(order: string[], shown: string[], part: string[], sortedByOrder: boolean): string[] {
	const seen = new Set(shown);
	const base = sortedByOrder ? order : [...shown, ...order.filter((k) => !seen.has(k))];
	return mergeOrder(base, part);
}

interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * In a grid: the cell a point is over, or the nearest one when it is in a gap, and which side
 * it lands on. A cell that fills most of a line splits top and bottom; a narrower one splits
 * left and right, since its neighbours sit beside it.
 */
export function gridDrop(x: number, y: number, cells: { key: string; box: Box }[], lineWidth: number): { key: string; position: 'before' | 'after' } | null {
	if (!cells.length) return null;
	const dist = (b: Box) => {
		const dx = x < b.left ? b.left - x : x > b.left + b.width ? x - b.left - b.width : 0;
		const dy = y < b.top ? b.top - y : y > b.top + b.height ? y - b.top - b.height : 0;
		return dx * dx + dy * dy;
	};
	const best = cells.reduce((a, c) => (dist(c.box) < dist(a.box) ? c : a));
	const b = best.box;
	const wide = lineWidth > 0 && b.width > lineWidth * 0.7;
	const before = wide ? y < b.top + b.height / 2 : x < b.left + b.width / 2;
	return { key: best.key, position: before ? 'before' : 'after' };
}
