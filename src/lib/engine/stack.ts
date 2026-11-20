// Ordering for Today: Habits with a cue time come first in time order, and a stacked
// Habit ("after X") follows straight after its anchor. Pure, so it is easy to test.

export interface Stackable {
	id: string;
	/** Cue time as HH:MM, or null. */
	time: string | null;
	/** The Habit this one is stacked after, or null. */
	afterId: string | null;
}

/** Ids in display order. Items keep their given order when nothing else decides. */
export function orderByCue<T extends Stackable>(items: T[]): T[] {
	const byId = new Map(items.map((it) => [it.id, it]));
	const children = new Map<string, T[]>();
	const roots: T[] = [];
	for (const it of items) {
		if (it.afterId && it.afterId !== it.id && byId.has(it.afterId)) {
			children.set(it.afterId, [...(children.get(it.afterId) ?? []), it]);
		} else roots.push(it);
	}
	const byTime = (a: T, b: T) =>
		a.time && b.time ? a.time.localeCompare(b.time) : a.time ? -1 : b.time ? 1 : 0;
	roots.sort(byTime);

	const out: T[] = [];
	const seen = new Set<string>();
	const visit = (it: T) => {
		if (seen.has(it.id)) return;
		seen.add(it.id);
		out.push(it);
		for (const c of [...(children.get(it.id) ?? [])].sort(byTime)) visit(c);
	};
	roots.forEach(visit);
	// Anything left sits in a loop of anchors (A after B after A); show it anyway.
	items.forEach(visit);
	return out;
}

/** Would stacking `id` after `afterId` create a loop? */
export function makesLoop(id: string, afterId: string | null, anchors: Map<string, string | null>) {
	let cur = afterId;
	for (let i = 0; cur && i <= anchors.size; i++) {
		if (cur === id) return true;
		cur = anchors.get(cur) ?? null;
	}
	return false;
}
