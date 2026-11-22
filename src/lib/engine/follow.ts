// A habit that follows its routine (a Follow schedule): the Follow as it is saved, and the
// schedule it gets when it has to stand on its own (the routine was deleted, or it is shared
// without it). Pure, so it can be tested.
import { followVariant, NOTHING_DUE, variantsIn, type Follow, type Plain, type Rotation, type Schedule } from './schedule';
import type { ISODate } from './dates';

/**
 * The Follow as it is saved: it logs one of the habit's own Variants (`own`), and its map only
 * pairs Variants the routine has (`routine`, when known) and brings up with a Variant of the
 * habit's that isn't the one it logs anyway. Nothing else changes, so an empty map is left out.
 */
export function fitFollow(f: Follow, own: string[], routine?: string[]): Follow {
	const ids = new Set(own);
	const theirs = routine ? new Set(routine) : null;
	const variantId = ids.has(f.variantId) || !own.length ? f.variantId : own[0];
	const counts = (p: string) => (!theirs || theirs.has(p)) && (!f.on || f.on.includes(p));
	const map = Object.fromEntries(Object.entries(f.map ?? {}).filter(([p, c]) => ids.has(c) && c !== variantId && counts(p)));
	const { map: _, ...rest } = f;
	return Object.keys(map).length ? { ...rest, variantId, map } : { ...rest, variantId };
}

/**
 * A starting map for a habit that begins to follow its routine: each routine Variant with the
 * habit's Variant of the same name (ignoring case and spaces at the ends), when there is one.
 * A gym routine "Upper A / Lower A" around a habit with the same Variants pairs them at once.
 */
export function pairByName(routine: { id: string; name: string }[], own: { id: string; name: string }[]): Record<string, string> {
	const key = (n: string) => n.trim().toLowerCase();
	const byName = new Map(own.map((v) => [key(v.name), v.id]));
	return Object.fromEntries(routine.flatMap((r) => (byName.has(key(r.name)) ? [[r.id, byName.get(key(r.name))!]] : [])));
}

/**
 * The closest schedule of its own: the routine's days, each with the Variant the habit logged
 * on them. Weekdays, every N days and N times a week carry over as they are. A rotation whose
 * days bring up more than one of the habit's Variants stays a rotation of those, with the rest
 * days of the routine's days it skipped added to the day before; one that always brings up the
 * same Variant becomes weekdays (by week) or its average gap (by Variant). Phases keep their
 * phases, each one turned the same way, with nothing due in a phase where none of the routine's
 * Variants it followed come up. Anything else (no schedule, a group, another Follow) becomes
 * every day.
 */
export function standaloneSchedule(parent: Schedule | null, f: Follow, start: ISODate): Schedule {
	const v = f.variantId;
	const counts = (pv: string) => !f.on || f.on.includes(pv);
	const as = (pv: string) => followVariant(f, pv);
	if (parent?.kind === 'phases')
		return {
			kind: 'phases',
			start: parent.start,
			phases: parent.phases.map((p) => ({
				...p,
				schedule: variantsIn(p.schedule).some(counts) ? (standaloneSchedule(p.schedule, f, start) as Plain) : NOTHING_DUE
			}))
		};
	if (parent?.kind === 'weekly')
		return { kind: 'weekly', days: Object.fromEntries(Object.entries(parent.days).filter(([, pv]) => pv && counts(pv)).map(([d, pv]) => [d, as(pv!)])) };
	if (parent?.kind === 'interval') return { kind: 'interval', every: parent.every, start: parent.start, variantId: as(parent.variantId) };
	if (parent?.kind === 'frequency') return { kind: 'frequency', times: parent.times, period: parent.period, variantId: as(parent.variantId) };
	if (parent?.kind === 'rotation' && parent.order.length) {
		const kept = keptOrder(parent, counts, as);
		const one = new Set(kept.map((o) => o.variantId)).size <= 1;
		// The routine's own rule for the habits inside it stays with the routine.
		const rotation = (order: Rotation['order']): Rotation => ({ kind: 'rotation', step: parent.step, order, onMiss: parent.onMiss, weekdays: parent.weekdays, start: parent.start });
		if (parent.step === 'week')
			return one
				? { kind: 'weekly', days: Object.fromEntries(parent.weekdays.map((d) => [String(d), kept[0]?.variantId ?? v])) }
				: rotation(kept.map((o) => ({ variantId: o.variantId, restDays: 0 })));
		if (!one) return rotation(kept);
		const cycle = parent.order.reduce((n, o) => n + o.restDays + 1, 0);
		return { kind: 'interval', every: Math.max(1, Math.round(cycle / (kept.length || parent.order.length))), start, variantId: kept[0]?.variantId ?? v };
	}
	return { kind: 'interval', every: 1, start, variantId: v };
}

/**
 * A rotation's order with only the routine Variants that bring the habit up, each turned into
 * the Variant the habit logs. A routine day it skips adds its day and rest days to the one
 * before it (the last one, for those at the start), so the cycle keeps its length.
 */
function keptOrder(r: Rotation, counts: (pv: string) => boolean, as: (pv: string) => string): Rotation['order'] {
	const kept: Rotation['order'] = [];
	let lead = 0;
	for (const o of r.order) {
		if (counts(o.variantId)) kept.push({ variantId: as(o.variantId), restDays: o.restDays });
		else if (kept.length) kept[kept.length - 1].restDays += o.restDays + 1;
		else lead += o.restDays + 1;
	}
	if (kept.length) kept[kept.length - 1].restDays += lead;
	return kept;
}
