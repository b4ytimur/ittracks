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
