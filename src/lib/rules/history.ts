// History policies: what an edit may do to data already logged, declared once per field.
// The conflict rules (core.ts) say which options block each other; these say what happens to
// the past when a field changes. The editors (to grey out or ask), the server (to refuse or
// migrate) and the tests read the same registries, and coverage.test.ts fails when a field of
// a form has no policy, so a new option can't ship without deciding what it does to history.
import { get, type FieldPath } from './core';

/**
 * - display: past logs don't depend on it (a name, a prefill, a reminder).
 * - versioned: the old value is kept with the logs it applied to (a schedule, targets).
 * - recompute: logs stay as they are; what is worked out from them (streaks, misses) is
 *   worked out again under the new value.
 * - migrate: changing it once logged asks what to do with past values (a unit: convert, or
 *   keep the numbers).
 * - locked: fixed once something is logged against it, except changes `allow` lets through.
 * - archive: a list whose items, removed after they were logged, are archived, not deleted.
 * - unguarded: a known gap. The edit still changes how past data reads; `past` says how.
 *   Listed so the registry tells the truth and the gap has a home until it is fixed.
 */
export type PastKind = 'display' | 'versioned' | 'recompute' | 'migrate' | 'locked' | 'archive' | 'unguarded';

export interface PastPolicy {
	kind: PastKind;
	/** What an edit does to data already logged, in the user's words. */
	past: string;
	/** locked: a change that stays safe once logged, such as a number becoming a count. */
	allow?: (from: unknown, to: unknown) => boolean;
	/** The value compared to tell whether the field changed: "lbs" to "lb" is not a unit change. */
	compare?: (form: never) => unknown;
}

/** One policy for every field of a form. Leaving a field out is a type error. */
export type Policies<F> = { readonly [K in FieldPath<F>]: PastPolicy };

export function definePolicies<F>(policies: Policies<F>): Policies<F> {
	return policies;
}

// ---------- builders ----------

export const display = (past = "Past logs don't depend on it"): PastPolicy => ({ kind: 'display', past });
export const versioned = (past: string): PastPolicy => ({ kind: 'versioned', past });
export const recompute = (past: string): PastPolicy => ({ kind: 'recompute', past });
export const archive = (past: string): PastPolicy => ({ kind: 'archive', past });
export const unguarded = (past: string): PastPolicy => ({ kind: 'unguarded', past });
export function locked(past: string, allow?: (from: unknown, to: unknown) => boolean): PastPolicy {
	return { kind: 'locked', past, allow };
}
export function migrate<F>(past: string, compare?: (form: F) => unknown): PastPolicy {
	return { kind: 'migrate', past, compare: compare as PastPolicy['compare'] };
}

// ---------- using the policies ----------

/** An edit to a field with data logged against it that its policy doesn't let through as is. */
export interface PastIssue {
	path: string;
	kind: 'locked' | 'migrate';
	/** The policy's words: what the edit would do to past data. */
	reason: string;
	from: unknown;
	to: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const valueOf = (p: PastPolicy, form: unknown, path: string) => (p.compare ? p.compare(form as never) : get(form, path));

/**
 * Locked and migrate fields an edit changes, when something is logged against the form.
 * Nothing logged: every edit is free, since there is no past to protect.
 */
export function pastIssues<F>(policies: Policies<F>, before: F, after: F, logged: boolean, prefix = ''): PastIssue[] {
	if (!logged) return [];
	const out: PastIssue[] = [];
	for (const [path, p] of Object.entries(policies) as [string, PastPolicy][]) {
		if (p.kind !== 'locked' && p.kind !== 'migrate') continue;
		const from = valueOf(p, before, path);
		const to = valueOf(p, after, path);
		if (same(from, to) || (p.kind === 'locked' && p.allow?.(get(before, path), get(after, path)))) continue;
		out.push({ path: prefix + path, kind: p.kind, reason: p.past, from: get(before, path), to: get(after, path) });
	}
	return out;
}

/** Is this field fixed right now? For greying out a control: the policy's reason, or null. */
export function lockedNow<F>(policies: Policies<F>, path: FieldPath<F>, logged: boolean): string | null {
	const p = (policies as Record<string, PastPolicy>)[path];
	return logged && p?.kind === 'locked' ? p.past : null;
}

/** Can `to` replace `from` in a locked field right now? */
export function allowedNow<F>(policies: Policies<F>, path: FieldPath<F>, logged: boolean, from: unknown, to: unknown): boolean {
	const p = (policies as Record<string, PastPolicy>)[path];
	return !logged || p?.kind !== 'locked' || same(from, to) || !!p.allow?.(from, to);
}

/**
 * Items an edit removes from each `archive` list, by id: those with logs are archived, the
 * rest can be deleted, since nothing points at them.
 */
export function removedItems<F>(
	policies: Policies<F>,
	before: F,
	after: F,
	logged: (path: string, id: string) => boolean
): Record<string, { archive: string[]; drop: string[] }> {
	const out: Record<string, { archive: string[]; drop: string[] }> = {};
	for (const [path, p] of Object.entries(policies) as [string, PastPolicy][]) {
		if (p.kind !== 'archive') continue;
		const now = new Set(((get(after, path) as { id: string }[] | undefined) ?? []).map((x) => x.id));
		const gone = ((get(before, path) as { id: string }[] | undefined) ?? []).map((x) => x.id).filter((id) => !now.has(id));
		out[path] = { archive: gone.filter((id) => logged(path, id)), drop: gone.filter((id) => !logged(path, id)) };
	}
	return out;
}
