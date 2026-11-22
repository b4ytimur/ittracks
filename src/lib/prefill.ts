// What the log screen saves of the values it suggests. A once-per-log field starts at last
// time's value or its target (its log setting), as a planned set does. Like a planned set
// nobody ticked, a suggested value nobody touched is not something logged now. Pure, so the
// log screen and the tests share the rule.

export type Values = Record<string, unknown>;

/** One place in the log as the screen holds it. */
export interface PlaceState {
	sets: { done: boolean; values: Values }[];
	summary: Values;
	tick?: boolean;
}

/** What the screen started a place with. */
export interface PlaceStart {
	/** The once-per-log values it suggested: last time's, or the targets. */
	prefill: Values;
	/** The once-per-log values already saved there. */
	saved: Values;
	/** Anything at all was saved there before (sets, ticks or values). */
	savedAny: boolean;
}

const empty = (v: unknown) => v === undefined || v === null || v === '' || v === false;

/** A once-per-log value still at the suggestion it started with, never saved. */
export const isSuggestion = (s: PlaceState, start: PlaceStart, id: string): boolean =>
	start.prefill[id] != null && !(id in start.saved) && (s.summary[id] ?? null) === start.prefill[id];

/** Something is logged at a place: a ticked set, a tick, something saved, or a value that isn't a suggestion. */
export const hasLog = (s: PlaceState, start: PlaceStart): boolean =>
	start.savedAny || !!s.tick || s.sets.some((x) => x.done) || Object.keys(s.summary).some((id) => !empty(s.summary[id]) && !isSuggestion(s, start, id));

const suggests = (s: PlaceState, start: PlaceStart) => Object.keys(s.summary).some((id) => !empty(s.summary[id]) && isSuggestion(s, start, id));

/**
 * Places that hold only suggestions while another place has something logged: a session left
 * half way, whose later rounds still show last time's values. Finish asks whether they were done.
 */
export function onlySuggested(states: PlaceState[], starts: PlaceStart[]): number[] {
	const logged = states.map((s, i) => hasLog(s, starts[i]));
	if (!logged.some(Boolean)) return [];
	return states.flatMap((s, i) => (!logged[i] && suggests(s, starts[i]) ? [i] : []));
}

/**
 * Whether a place's suggested values are saved with it. Saving as you go leaves them out: they
 * are only suggestions until the log is finished. Finish keeps them at a place with something
 * logged, and everywhere when nothing at all was touched (finished as planned) or `confirmed`
 * (the answer to onlySuggested's question).
 */
export function keepsSuggestions(states: PlaceState[], starts: PlaceStart[], i: number, opts: { finish: boolean; confirmed: boolean }): boolean {
	if (!opts.finish) return false;
	if (opts.confirmed) return true;
	const logged = states.map((s, j) => hasLog(s, starts[j]));
	return logged[i] || !logged.some(Boolean);
}
