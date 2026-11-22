// What the schedule editor does to a schedule, as pure functions: a new schedule of a kind,
// keeping it in step with the habit's Variants, and phases. The habit page and every phase use
// the same ScheduleFields component, and both go through these.
import type { PhaseForm, PlainScheduleForm } from '$lib/forms';
import type { ISODate } from '$lib/engine/dates';
import { phaseSpans, type Phases } from '$lib/engine/schedule';

export type PlainKind = PlainScheduleForm['kind'];
export const plainKinds: PlainKind[] = ['weekly', 'frequency', 'interval', 'rotation'];
export const isPlainKind = (k: string): k is PlainKind => (plainKinds as string[]).includes(k);

type Variant = { id: string };

/**
 * A schedule of `kind`, starting from `from` where it can: the same Variant, the same start.
 * Anything it can't carry over takes the editor's defaults (Mon, Wed, Fri; 3 a week; every day).
 */
export function plainOfKind(kind: PlainKind, from: PlainScheduleForm | null, variants: Variant[], start: ISODate): PlainScheduleForm {
	const first = variants[0]?.id ?? '';
	const one = from && 'variantId' in from ? from.variantId : from?.kind === 'weekly' ? (Object.values(from.days)[0] ?? first) : from?.kind === 'rotation' ? from.order[0]?.variantId : first;
	const begin = from && 'start' in from ? from.start : start;
	switch (kind) {
		case 'weekly':
			return { kind, days: Object.fromEntries([0, 2, 4].map((d) => [String(d), one || first])) };
		case 'frequency':
			return { kind, times: 3, period: 'week', variantId: one || first };
		case 'interval':
			return { kind, every: 1, start: begin, variantId: one || first };
		case 'rotation':
			return { kind, step: 'variant', onMiss: 'wait', weekdays: [], start: begin, order: variants.map((v) => ({ variantId: v.id, restDays: 1 })) };
	}
}

/**
 * The schedule with only Variants the habit has. A rotation goes through them in the order
 * the habit lists them: all of them (`all`, the habit's own schedule), or the ones it already
 * had (inside a phase, where each phase can rotate its own); never none.
 */
export function fitVariants(s: PlainScheduleForm, variants: Variant[], all: boolean): PlainScheduleForm {
	const ids = new Set(variants.map((v) => v.id));
	const first = variants[0]?.id ?? '';
	switch (s.kind) {
		case 'weekly':
			return { ...s, days: Object.fromEntries(Object.entries(s.days).filter(([, v]) => ids.has(v))) };
		case 'frequency':
		case 'interval':
			return ids.has(s.variantId) ? s : { ...s, variantId: first };
		case 'rotation': {
			const rest = new Map(s.order.map((o) => [o.variantId, o.restDays]));
			const kept = variants.filter((v) => all || rest.has(v.id));
			const order = (kept.length ? kept : variants.slice(0, 1)).map((v) => ({ variantId: v.id, restDays: rest.get(v.id) ?? 1 }));
			return { ...s, order, weekdays: s.step === 'week' ? [...s.weekdays].sort() : [] };
		}
	}
}

/** A phase row in the editor: a phase with a key the list can keep track of. */
export type PhaseRow = PhaseForm & { key: string };

/**
 * Adding a phase: it runs on with no end, after the others. The phase before it gets a length
 * if it had none (1 week), since a phase after one with no end would never come. It starts as
 * a copy of the phase before it, so changing one thing (the Variant, the times) is one step.
 */
export function addPhase(rows: PhaseRow[], key: string, fallback: PlainScheduleForm): PhaseRow[] {
	const last = rows.at(-1);
	const before = rows.map((r, i) => (i === rows.length - 1 && r.length === null ? { ...r, length: 1, unit: 'week' as const } : r));
	return [...before, { key, length: null, unit: last?.unit ?? 'week', schedule: structuredClone(last?.schedule ?? fallback) }];
}

/**
 * Removing a phase, the other way round from adding one: when the last phase ran on with no
 * end, the phase before it now does. The only phase is never removed.
 */
export function removePhase(rows: PhaseRow[], key: string): PhaseRow[] {
	if (rows.length < 2) return rows;
	const i = rows.findIndex((r) => r.key === key);
	if (i < 0) return rows;
	const left = rows.filter((r) => r.key !== key);
	return i === rows.length - 1 && rows[i].length === null ? left.map((r, j) => (j === left.length - 1 ? { ...r, length: null } : r)) : left;
}

/** The first and last day of each phase row, from `start` (null: it has no end, or never comes). */
export function phaseDates(start: ISODate, rows: PhaseForm[]): { from: ISODate | null; to: ISODate | null }[] {
	const spans = phaseSpans({ kind: 'phases', start, phases: rows } as Phases);
	return rows.map((_, i) => {
		const s = spans.find((x) => x.index === i);
		return s ? { from: s.from, to: s.to } : { from: null, to: null };
	});
}
