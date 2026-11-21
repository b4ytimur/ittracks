// Fill rules: how an open Slot picks a Task from the Library by Tags.
// Tag levels: low = 1, medium = 2, high = 3; a missing Tag counts as 0.

export interface FillRule {
	/** Tag name -> minimum level. */
	must?: Record<string, number>;
	/** Tag name -> maximum level. */
	mustNot?: Record<string, number>;
	/** Tag names that rank a Task higher. */
	prefer?: string[];
}

export interface Candidate {
	id: string;
	tags: Record<string, number>;
	/** Last date this Task was done, YYYY-MM-DD, or null if never. */
	lastDone: string | null;
}

/** Does a Task with these Tags pass a rule's must and must-not lists? */
export function matches(rule: FillRule, tags: Record<string, number>): boolean {
	const level = (tag: string) => tags[tag] ?? 0;
	return (
		Object.entries(rule.must ?? {}).every(([t, min]) => level(t) >= min) &&
		Object.entries(rule.mustNot ?? {}).every(([t, max]) => level(t) <= max)
	);
}

/**
 * Pick a Task for an open Slot.
 * 1. Keep Tasks that pass the must and must-not rules.
 * 2. Drop Tasks already used in this Occurrence.
 * 3. Rank by preferred Tags, then least recently done.
 * 4. Break ties with `random` (injectable for tests).
 */
export function pickTask(
	rule: FillRule,
	library: Candidate[],
	alreadyPicked: Set<string> = new Set(),
	random: () => number = Math.random
): string | null {
	const level = (c: Candidate, tag: string) => c.tags[tag] ?? 0;

	const pool = library.filter((c) => !alreadyPicked.has(c.id) && matches(rule, c.tags));
	if (pool.length === 0) return null;

	const score = (c: Candidate) => (rule.prefer ?? []).reduce((s, t) => s + level(c, t), 0);
	// Never-done Tasks sort first, then the oldest.
	const recency = (c: Candidate) => c.lastDone ?? '';

	const ranked = pool
		.map((c) => ({ c, s: score(c), r: recency(c), tie: random() }))
		.sort((a, b) => b.s - a.s || a.r.localeCompare(b.r) || a.tie - b.tie);
	return ranked[0].c.id;
}
