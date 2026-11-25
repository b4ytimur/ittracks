// The logic behind the shared editable list (EditableList.svelte), kept pure so it can be
// tested without a browser: where a drop lands, what order a move gives, and range selection.
// Lists work on keys (strings), never on the items themselves, so any kind of row fits.

/** What a list tells each row it renders. */
export type Mode = 'use' | 'edit' | 'select';

export interface RowContext {
	index: number;
	mode: Mode;
	editing: boolean;
	selecting: boolean;
	selected: boolean;
	dragging: boolean;
}

/** Where a dragged row lands relative to the row it is dropped on. */
export type Position = 'before' | 'after' | 'inside';

/** One move: put `key` before, after or inside `target`. */
export interface Move {
	key: string;
	target: string;
	position: Position;
}

/**
 * The drop position for a pointer at `y` over a row. Without nesting the row splits in two
 * halves; with nesting the middle half means "inside" and a quarter at each edge "before" or "after".
 */
export function dropPosition(y: number, rect: { top: number; height: number }, nest: boolean): Position {
	const at = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
	if (!nest) return at < 0.5 ? 'before' : 'after';
	if (at < 0.25) return 'before';
	if (at > 0.75) return 'after';
	return 'inside';
}

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
