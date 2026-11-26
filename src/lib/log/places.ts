// What is being logged, by where it sits: a place's path and the Task in it. Never by its number
// in the list, so a swap, a reroll or a part added elsewhere never moves another place's values.

export interface At {
	path: string;
	task: { id: string } | null;
}

export const placeKey = (it: At) => `${it.path}|${it.task?.id ?? ''}`;

/** A draft's places. One from before this kept a list, which fits only a log as long as it was. */
export function fromDraft<S>(saved: S[] | Record<string, S>, items: At[]): Record<string, S> {
	if (!Array.isArray(saved)) return saved;
	return saved.length === items.length ? Object.fromEntries(items.map((it, i) => [placeKey(it), saved[i]])) : {};
}

/** What a log saves at a place: a set, a place's once-per-log values, or a tick. */
export interface Logged {
	taskId: string;
	path: string | null;
	values: Record<string, unknown>;
}

/**
 * What a log saves besides the places it shows: what each place it no longer shows held when it
 * last did (`held`, by place: a swap, Pick another or a reload took it away before that reached the
 * server), then what the server holds that no place shows, unless `held` has that place, since what
 * a place held grew from what was saved there.
 */
export function besides<E extends Logged>(held: Record<string, E[]>, shown: At[], orphans: E[]): E[] {
	const here = new Set(shown.map(placeKey));
	const gone = new Set(Object.keys(held).filter((k) => !here.has(k)));
	return [...[...gone].flatMap((k) => held[k]), ...orphans.filter((e) => !gone.has(`${e.path}|${e.taskId}`))];
}

/** A set: neither a place's once-per-log values nor a Yes or no tick. */
const isSet = (v: Record<string, unknown>) => v._summary !== true && !(v.done === true && Object.keys(v).length === 1);

/**
 * What was done at a place with another Task before its Slot was swapped, by that Task: its sets
 * (0 when it has only once-per-log values or a tick). `extra` is what the log saves besides the
 * places it shows (see `besides`); what sits at no place shown is gone from the habit instead.
 */
export function doneBefore(extra: Logged[], it: At): { taskId: string; sets: number }[] {
	const out = new Map<string, number>();
	for (const e of extra) if (e.path === it.path && e.taskId !== it.task?.id) out.set(e.taskId, (out.get(e.taskId) ?? 0) + (isSet(e.values) ? 1 : 0));
	return [...out].map(([taskId, sets]) => ({ taskId, sets }));
}

/** What a log holds that sits at no place it shows: gone from the habit (a part removed), not done before a swap. */
export const goneFrom = <E extends { path: string | null }>(extra: E[], shown: { path: string }[]) => extra.filter((e) => !shown.some((it) => it.path === e.path));

/** A Slot's line for a Task done there before a swap, in that Task's own words: "Bench press · 2 sets done". */
export const doneLine = (name: string, sets: number, one: string, many: string) => `${name} · ${sets ? `${sets} ${sets === 1 ? one : many} ` : ''}done`;

/** The sets a Task swapped in still has to do: the Slot's planned count less those done before, at least 1. */
export const setsToDo = (planned: number, done: number) => (done ? Math.max(1, planned - done) : planned);

/**
 * The band's line for a swap or Pick another. `scope` is "today only", or a past day's date and "only".
 * Back to the plan's own Task, it says so instead.
 */
export function swapText(was: string | null, now: string, how: 'swap' | 'back' | 'reroll', scope: string): string {
	if (how === 'back') return `Back to ${now}, as planned.`;
	return `${how === 'reroll' ? 'Picked' : 'Using'} ${now}${was ? ` instead of ${was}` : ''}, ${scope}.`;
}
