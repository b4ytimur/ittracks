// A habit that follows its routine (a Follow schedule) and has to stand on its own: the
// routine was deleted. Pure, so it can be tested.
import { NOTHING_DUE, variantsIn, type Follow, type Plain, type Schedule } from './schedule';
import type { ISODate } from './dates';

/**
 * The closest schedule of its own: the routine's days, on the habit's own Variant. Weekdays,
 * every N days and N times a week carry over as they are; a rotation by week keeps its
 * weekdays; a rotation of Variants keeps its average gap. Phases keep their phases, each one
 * turned the same way, with nothing due in a phase where none of the routine's Variants it
 * followed come up. Anything else (no schedule, a group, another Follow) becomes every day.
 */
export function standaloneSchedule(parent: Schedule | null, f: Follow, start: ISODate): Schedule {
	const v = f.variantId;
	const counts = (pv: string) => !f.on || f.on.includes(pv);
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
		return { kind: 'weekly', days: Object.fromEntries(Object.entries(parent.days).filter(([, pv]) => pv && counts(pv)).map(([d]) => [d, v])) };
	if (parent?.kind === 'interval') return { kind: 'interval', every: parent.every, start: parent.start, variantId: v };
	if (parent?.kind === 'frequency') return { kind: 'frequency', times: parent.times, period: parent.period, variantId: v };
	if (parent?.kind === 'rotation' && parent.step === 'week')
		return { kind: 'weekly', days: Object.fromEntries(parent.weekdays.map((d) => [String(d), v])) };
	if (parent?.kind === 'rotation' && parent.order.length) {
		const cycle = parent.order.reduce((n, o) => n + o.restDays + 1, 0);
		const mine = parent.order.filter((o) => counts(o.variantId)).length || parent.order.length;
		return { kind: 'interval', every: Math.max(1, Math.round(cycle / mine)), start, variantId: v };
	}
	return { kind: 'interval', every: 1, start, variantId: v };
}
