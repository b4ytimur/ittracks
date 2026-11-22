// Options a log picks from, each with a stable id: a Choice field's options and a break habit's
// feelings. Logs store the id, so renaming an option renames it in every past log, and an option
// removed after it was logged is archived: new logs no longer offer it, old ones still name it.
// An id only has to be unique within its own list.
import { z } from 'zod';

export interface ChoiceOption {
	id: string;
	name: string;
	/** Removed from the list after a log used it: kept so that log still reads. */
	archived?: boolean;
}

/** An option as the editors send it: archived ones never leave the server. */
export const optionForm = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(40) });

/** The options a new log offers. */
export const activeOptions = <T extends ChoiceOption>(options: readonly T[] | null | undefined): T[] =>
	(options ?? []).filter((o) => !o.archived);

/** The name a stored value stands for, archived options included. Null when no option has that id. */
export function optionName(options: readonly ChoiceOption[] | null | undefined, id: unknown): string | null {
	return typeof id === 'string' ? ((options ?? []).find((o) => o.id === id)?.name ?? null) : null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The option a value given by id or by name stands for, among the options a new log offers.
 * Names match ignoring case and extra spaces. How the API and links take a value.
 */
export function findOption<T extends ChoiceOption>(options: readonly T[] | null | undefined, v: unknown): T | null {
	if (typeof v !== 'string' || !v.trim()) return null;
	const active = activeOptions(options);
	return active.find((o) => o.id === v) ?? active.find((o) => norm(o.name) === norm(v)) ?? null;
}

/** Options with new ids, from names: templates and anything else that has only the words. */
export const optionsFrom = (names: readonly string[]): ChoiceOption[] => names.map((name) => ({ id: crypto.randomUUID(), name }));

/** Two options with the same name can't be told apart by name (the API logs by name). */
export const repeatedName = (options: readonly { name: string }[]): string | null => {
	const seen = new Set<string>();
	for (const o of options) {
		const k = norm(o.name);
		if (seen.has(k)) return o.name;
		seen.add(k);
	}
	return null;
};

/**
 * The list to save: the edited options in their order, then the saved ones they leave out that
 * logs still use (`archive`), or that were archived already. Options no log used are dropped.
 */
export function mergeOptions(
	saved: readonly ChoiceOption[] | null | undefined,
	edited: readonly { id: string; name: string }[],
	archive: readonly string[]
): ChoiceOption[] {
	const now = new Set(edited.map((o) => o.id));
	const keep = new Set(archive);
	return [
		...edited.map(({ id, name }) => ({ id, name })),
		...(saved ?? []).filter((o) => !now.has(o.id) && (o.archived || keep.has(o.id))).map((o) => ({ id: o.id, name: o.name, archived: true }))
	];
}

// ---------- numbers per option (a mood 5 to 1), versioned ----------

export type Scores = Record<string, number>;

/** Numbers that applied up to and including `until`, before an edit changed them. */
export interface EarlierScores {
	until: string;
	scores: Scores;
}

/** The numbers in force on a day: the earliest earlier set that still covers it, else the current. */
export function scoresOn(current: Scores | null | undefined, earlier: readonly EarlierScores[] | null | undefined, date: string): Scores {
	for (const e of earlier ?? []) if (date <= e.until) return e.scores;
	return current ?? {};
}

/**
 * The earlier numbers to keep when an edit changes the numbers of a field with logs: the old
 * set, with `until` (the day before the change) as its last day. Nothing is kept when no
 * number past logs used changes, when there were no numbers before (new ones apply to the
 * past too), or when this day's change already kept the set the past used.
 */
export function keepEarlierScores(
	current: Scores | null | undefined,
	earlier: readonly EarlierScores[] | null | undefined,
	next: Scores,
	until: string
): EarlierScores[] {
	const was = current ?? {};
	const list = [...(earlier ?? [])];
	const changed = Object.entries(was).some(([id, n]) => next[id] !== n);
	if (!changed || list.some((e) => e.until >= until)) return list;
	return [...list, { until, scores: was }];
}
