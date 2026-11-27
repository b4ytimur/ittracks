// Moving a Stats board among its tabs (BoardTabs.svelte): the places Move… offers, and what the band says after.
import { moveBy, moveKey } from '$lib/ui/list';

export interface Named {
	id: string;
	name: string;
}

/** Where Move… can put a board: First, then After each other board, leaving out the place it already has. */
export function boardPlaces(boards: Named[], id: string): { label: string; order: string[] }[] {
	const ids = boards.map((b) => b.id);
	const i = ids.indexOf(id);
	if (i < 0) return [];
	const first = i > 0 ? [{ label: 'First', order: [id, ...ids.filter((x) => x !== id)] }] : [];
	return [...first, ...boards.filter((b) => b.id !== id && b.id !== ids[i - 1]).map((b) => ({ label: `After ${b.name}`, order: moveKey(ids, id, b.id, 'after') }))];
}

/** The band's line once a board moved to `order`: where it stands now, by the board before it, or first (Move…'s own word). */
export function movedSaid(boards: Named[], order: string[], id: string): string {
	const name = (x: string) => boards.find((b) => b.id === x)?.name ?? '';
	const i = order.indexOf(id);
	return i > 0 ? `Moved “${name(id)}” after “${name(order[i - 1])}”.` : `Moved “${name(id)}” first.`;
}

/** The order Alt with ← or → on a focused tab asks for: one place the way the tabs read (flipped right to left), the same
 *  order at an edge. Null for any other key, so the key keeps its own job; Alt + ← is the browser's Back otherwise. */
export function keyMoved(ids: string[], id: string, k: { key: string; altKey: boolean }, rtl: boolean): string[] | null {
	if (!k.altKey || (k.key !== 'ArrowLeft' && k.key !== 'ArrowRight')) return null;
	return moveBy(ids, id, (k.key === 'ArrowLeft') !== rtl ? -1 : 1);
}
