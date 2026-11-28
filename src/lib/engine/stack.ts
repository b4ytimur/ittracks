// Ordering for Today: Habits with a cue time come first in time order, and a stacked
// Habit ("after X") follows straight after its anchor. Pure, so it is easy to test.

import { dayOrder } from './day';

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

// Today by time: the day as a timeline.

export interface Timed {
	id: string;
	/** When it is due as HH:MM (a part of the day counts from its start), or null: any time. */
	clock: string | null;
	/** What the timeline says for that time: the clock time, or the part of the day's name. */
	label: string | null;
	/** A group's habits, each with its own time (null: the group's). A routine is done in one go, so it passes none. */
	kids?: Timed[];
	/** A group's habit: finished, and past its moment in place. */
	done?: boolean;
}

export interface Slot<T> {
	/** The clock time, or '' for any time. */
	key: string;
	label: string | null;
	items: T[];
	/** A group standing in more than one slot: the ids of the habits it holds in this one. */
	only: Map<string, Set<string>>;
}

/**
 * One slot per time, in the order the day is lived, split at `now` into what is past (and still shown) and what is
 * ahead; the habits with no time come between them, since they fit now. A group whose habits are at different times
 * stands in each of their slots, holding only the habits at that time. Items keep their order within a slot.
 *
 * The view's done word reaches a whole habit before it gets here, but a group with a habit still due isn't finished, so
 * it only meets that group's times. With `apart`, a time where all of a group's habits are done leaves its slot for
 * `done`, which the page puts where the done word says (at the end, in the Done fold, or nowhere).
 */
export function timeline<T extends Timed>(items: T[], now: string, dayStart = '00:00', apart = false) {
	const slots = new Map<string, Slot<T>>();
	const put = (clock: string | null, label: string | null, item: T, kids?: string[]) => {
		const key = clock ?? '';
		let s = slots.get(key);
		if (!s) slots.set(key, (s = { key, label: clock ? label : null, items: [], only: new Map() }));
		if (!s.items.includes(item)) s.items.push(item);
		if (kids) s.only.set(item.id, new Set([...(s.only.get(item.id) ?? []), ...kids]));
	};
	const done: Slot<T> = { key: 'done', label: 'Done', items: [], only: new Map() };
	for (const it of items) {
		const at = new Map<string | null, Timed[]>();
		for (const k of it.kids ?? []) at.set(k.clock ?? it.clock, [...(at.get(k.clock ?? it.clock) ?? []), k]);
		const labelOf = (ks: Timed[]) => (ks[0].clock ? ks[0].label : it.label);
		if (at.size > 1)
			for (const [c, ks] of at) {
				if (!apart || !ks.every((k) => k.done)) put(c, labelOf(ks), it, ks.map((k) => k.id));
				else {
					if (!done.items.includes(it)) done.items.push(it);
					done.only.set(it.id, new Set([...(done.only.get(it.id) ?? []), ...ks.map((k) => k.id)]));
				}
			}
		else if (at.size === 1) put([...at.keys()][0], labelOf([...at.values()][0]), it);
		else put(it.clock, it.label, it);
	}
	const order = (s: Slot<T>) => dayOrder(s.key, dayStart);
	const timed = [...slots.values()].filter((s) => s.key).sort((a, b) => order(a) - order(b));
	const cut = dayOrder(now, dayStart);
	return { past: timed.filter((s) => order(s) <= cut), anyTime: slots.get('') ?? null, ahead: timed.filter((s) => order(s) > cut), done };
}
