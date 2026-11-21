// The rule registry: which options block each other, declared once.
// Validation (server and template import), the editors' disabled states, clean-up before
// save, and the tests all read these rules. Every field of a form must have an entry
// (`independent` when it has no conflicts), so a new option can't ship without its rules:
// `defineRules<Form>` fails the type check when a field is missing, and coverage.test.ts
// fails when a Zod schema has a field the registry doesn't list.

/** Where a field lives, as a dotted path: "cue.time", "levels.enabled". */
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
type IsGroup<V> = [V] extends [readonly unknown[]]
	? false
	: [V] extends [Record<string, unknown>]
		? string extends keyof V
			? false // a record of ids, like Slot targets: one field
			: true extends IsUnion<V>
				? false // a choice of shapes, like the Schedule: one field
				: true
		: false;

/**
 * Every field of a form. Plain nested objects (the cue, levels) are split into their
 * fields; arrays, records, unions and nullable objects are one field each.
 */
export type FieldPath<T> = {
	[K in keyof T & string]-?: null extends T[K]
		? K
		: IsGroup<T[K]> extends true
			? `${K}.${FieldPath<T[K]>}`
			: K;
}[keyof T & string];

export type Severity = 'block' | 'warn';

/** What a rule says is wrong. */
export interface Issue {
	/** The field that is blocked or wrong. */
	path: string;
	/** The other field in a conflict, when there is one: the one to switch to. */
	other?: string;
	reason: string;
	severity: Severity;
	rule: Constraint<never, never>['kind'];
}

export type When<F, C> = (form: F, ctx: C) => boolean;

export type Constraint<F, C> =
	/** Only one of the two can be set. `wins` decides which is kept when old data has both. */
	| { kind: 'exclusive'; other: string; reason: string; wins: boolean; fixed?: string }
	/** This field needs at least one of the others to be set. */
	| { kind: 'requiresAny'; others: string[]; reason: string; clear: unknown }
	/** This field means nothing unless `when` holds; otherwise it is reset to `clear` before saving. */
	| { kind: 'onlyWhen'; when: When<F, C>; reason: string; clear: unknown }
	/** A rule across fields, such as two numbers that must agree. `bad` returns true when broken. */
	| { kind: 'check'; bad: When<F, C>; reason: string; severity: Severity };

export type Rule<F, C> = readonly Constraint<F, C>[];

/** A field that blocks nothing and is blocked by nothing. Listing it is still required. */
export const independent = [] as const;

/**
 * A registry: one entry per field. The key list must be complete; leaving a field out
 * is a type error ("Property 'x' is missing").
 */
export type Rules<F, C = undefined> = { readonly [K in FieldPath<F>]: Rule<F, C> };

export function defineRules<F, C = undefined>(rules: Rules<F, C>): Rules<F, C> {
	return rules;
}

// ---------- builders ----------

/**
 * `fixed` is the note shown when old data had both and this side was cleared:
 * "kept the time, cleared the part of the day".
 */
export function exclusive(other: string, reason: string, opts: { wins?: boolean; fixed?: string } = {}) {
	return { kind: 'exclusive', other, reason, wins: opts.wins ?? false, fixed: opts.fixed } as const;
}

export function requiresAny(others: string[], reason: string, clear: unknown) {
	return { kind: 'requiresAny', others, reason, clear } as const;
}

export function onlyWhen<F, C = undefined>(when: When<F, C>, reason: string, clear: unknown): Constraint<F, C> {
	return { kind: 'onlyWhen', when, reason, clear };
}

export function check<F, C = undefined>(bad: When<F, C>, reason: string, severity: Severity = 'block'): Constraint<F, C> {
	return { kind: 'check', bad, reason, severity };
}

// ---------- reading and writing fields ----------

export function get(form: unknown, path: string): unknown {
	let v: unknown = form;
	for (const k of path.split('.')) v = v == null ? undefined : (v as Record<string, unknown>)[k];
	return v;
}

/** A copy of the form with one field changed. */
export function set<F>(form: F, path: string, value: unknown): F {
	const [k, ...rest] = path.split('.');
	const base = (form ?? {}) as Record<string, unknown>;
	return { ...base, [k]: rest.length ? set(base[k], rest.join('.'), value) : value } as F;
}

/** Is a field filled in? Empty strings, null, false, [] and {} count as not set. */
export function isSet(v: unknown): boolean {
	if (v === null || v === undefined || v === '' || v === false) return false;
	if (Array.isArray(v)) return v.length > 0;
	if (typeof v === 'object') return Object.keys(v).length > 0;
	return true;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const entries = <F, C>(rules: Rules<F, C>) => Object.entries(rules) as [string, Rule<F, C>][];

// ---------- using the rules ----------

/**
 * Everything wrong with a form. Fields an onlyWhen rule makes meaningless are not
 * reported: normalize() clears them. An exclusive pair is reported once, on the field
 * that does not win.
 */
export function evaluate<F, C>(rules: Rules<F, C>, form: F, ctx: C, prefix = ''): Issue[] {
	const issues: Issue[] = [];
	for (const [path, rule] of entries(rules)) {
		const v = get(form, path);
		for (const c of rule) {
			if (c.kind === 'exclusive') {
				if (c.wins || !isSet(v) || !isSet(get(form, c.other))) continue;
				issues.push({ path: prefix + path, other: prefix + c.other, reason: c.reason, severity: 'block', rule: c.kind });
			} else if (c.kind === 'requiresAny') {
				if (isSet(v) && !c.others.some((o) => isSet(get(form, o))))
					issues.push({ path: prefix + path, reason: c.reason, severity: 'block', rule: c.kind });
			} else if (c.kind === 'check') {
				if (c.bad(form, ctx)) issues.push({ path: prefix + path, reason: c.reason, severity: c.severity, rule: c.kind });
			}
		}
	}
	return issues;
}

/**
 * Should this field be greyed out right now, and why? For an exclusive pair, a field is
 * blocked while the other one is set. Returns null when the field can be used.
 */
export function blocked<F, C>(rules: Rules<F, C>, form: F, path: FieldPath<F>, ctx: C): Issue | null {
	for (const c of (rules as Record<string, Rule<F, C>>)[path] ?? []) {
		if (c.kind === 'exclusive' && isSet(get(form, c.other)) && !isSet(get(form, path)))
			return { path, other: c.other, reason: c.reason, severity: 'block', rule: c.kind };
		if (c.kind === 'requiresAny' && !c.others.some((o) => isSet(get(form, o))))
			return { path, reason: c.reason, severity: 'block', rule: c.kind };
		if (c.kind === 'onlyWhen' && !c.when(form, ctx)) return { path, reason: c.reason, severity: 'block', rule: c.kind };
	}
	return null;
}

export interface Normalized<F> {
	form: F;
	/** What was changed, in the user's words, for a one-line note. */
	fixed: string[];
}

/**
 * Clear values that can't apply. onlyWhen and requiresAny fields that don't apply go back
 * to their `clear` value. With `resolve`, an exclusive pair that is both set keeps the
 * winner and clears the other: used to fix old data, never to override a user's save.
 */
export function normalize<F, C>(rules: Rules<F, C>, form: F, ctx: C, opts: { resolve?: boolean } = {}): Normalized<F> {
	let out = form;
	const fixed: string[] = [];
	for (const [path, rule] of entries(rules)) {
		for (const c of rule) {
			const v = get(out, path);
			if (c.kind === 'onlyWhen' && !c.when(out, ctx) && !same(v, c.clear)) {
				out = set(out, path, c.clear);
			} else if (c.kind === 'requiresAny' && isSet(v) && !c.others.some((o) => isSet(get(out, o)))) {
				out = set(out, path, c.clear);
			} else if (opts.resolve && c.kind === 'exclusive' && !c.wins && isSet(v) && isSet(get(out, c.other))) {
				out = set(out, path, null);
				fixed.push(c.fixed ?? c.reason);
			}
		}
	}
	return { form: out, fixed };
}

/** Clear `path` so `other` can be used: the "Use this instead" swap. */
export function swap<F>(form: F, from: string, clear: unknown = null): F {
	return set(form, from, clear);
}
