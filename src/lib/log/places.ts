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
