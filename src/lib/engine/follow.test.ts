import { describe, expect, it } from 'vitest';
import { dueOn, followVariant, rollupRuleOf, variantsIn, type Follow, type Schedule } from './schedule';
import { fitFollow, pairByName, standaloneSchedule } from './follow';

const f = (on: string[] | null = null): Follow => ({ kind: 'follow', variantId: 'mine', on });

describe('a habit that follows its routine', () => {
	it('is due when the routine is, with its own Variant', () => {
		const parent = (d: string) => (d === '2026-11-23' ? 'A' : d === '2026-11-24' ? 'B' : null);
		expect(dueOn(f(), [], '2026-11-23', parent)).toBe('mine');
		expect(dueOn(f(), [], '2026-11-25', parent)).toBeNull();
		expect(dueOn(f(['B']), [], '2026-11-23', parent)).toBeNull();
		expect(dueOn(f(['B']), [], '2026-11-24', parent)).toBe('mine');
		// Due with no Variant known: every day counts, a chosen Variant doesn't match.
		expect(dueOn(f(), [], '2026-11-23', () => '')).toBe('mine');
		expect(dueOn(f(['A']), [], '2026-11-23', () => '')).toBeNull();
		// Without its routine it never comes up.
		expect(dueOn(f(), [], '2026-11-23')).toBeNull();
	});

	it('takes the routine’s rule; a routine without one counts all the habits inside', () => {
		expect(rollupRuleOf({ kind: 'interval', every: 1, start: '2026-11-01', variantId: 'v' })).toEqual({ target: null, minimum: null });
		expect(rollupRuleOf({ kind: 'interval', every: 1, start: '2026-11-01', variantId: 'v', rollup: { target: 2, minimum: 1 } })).toEqual({ target: 2, minimum: 1 });
		expect(rollupRuleOf({ kind: 'group', target: 3, minimum: null })).toEqual({ target: 3, minimum: null });
	});

	it('stands on its own with the routine’s days when the routine is gone', () => {
		expect(standaloneSchedule({ kind: 'weekly', days: { 0: 'A', 2: 'B', 4: 'A' } }, f(['A']), '2026-11-01')).toEqual({ kind: 'weekly', days: { 0: 'mine', 4: 'mine' } });
		expect(standaloneSchedule({ kind: 'interval', every: 2, start: '2026-11-01', variantId: 'A' }, f(), '2026-11-10')).toEqual({ kind: 'interval', every: 2, start: '2026-11-01', variantId: 'mine' });
		expect(standaloneSchedule({ kind: 'frequency', times: 3, period: 'week', variantId: 'A' }, f(), '2026-11-10')).toMatchObject({ kind: 'frequency', times: 3, variantId: 'mine' });
		const rot = { kind: 'rotation' as const, step: 'variant' as const, order: [{ variantId: 'A', restDays: 1 }, { variantId: 'B', restDays: 1 }], onMiss: 'wait' as const, weekdays: [], start: '2026-11-01' };
		expect(standaloneSchedule(rot, f(['A']), '2026-11-10')).toEqual({ kind: 'interval', every: 4, start: '2026-11-10', variantId: 'mine' });
		expect(standaloneSchedule(null, f(), '2026-11-10')).toEqual({ kind: 'interval', every: 1, start: '2026-11-10', variantId: 'mine' });
	});
});

describe('a habit that follows its routine with a Variant map', () => {
	// Routine Variants UA, LA, UB, LB; the habit's own Heavy and Light.
	const bench: Follow = { kind: 'follow', variantId: 'heavy', on: ['UA', 'UB'], map: { UB: 'light' } };
	const byDate: Record<string, string> = { '2026-11-23': 'UA', '2026-11-24': 'LA', '2026-11-25': 'UB', '2026-11-26': 'LB' };
	const parent = (d: string) => byDate[d] ?? null;

	it('logs the Variant the routine’s Variant that day maps to, and its own on the rest', () => {
		expect(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'].map((d) => dueOn(bench, [], d, parent))).toEqual(['heavy', null, 'light', null, null]);
		// Every day of the routine: the unpaired ones and a day with no Variant known log its own.
		const all: Follow = { kind: 'follow', variantId: 'main', on: null, map: { UA: 'heavy', UB: 'light' } };
		expect(['2026-11-23', '2026-11-24', '2026-11-25'].map((d) => dueOn(all, [], d, parent))).toEqual(['heavy', 'main', 'light']);
		expect(dueOn(all, [], '2026-11-23', () => '')).toBe('main');
		expect(followVariant(all, 'LA')).toBe('main');
	});

	it('lists the Variants it can log', () => {
		expect(variantsIn(bench)).toEqual(['heavy', 'light']);
		expect(variantsIn({ kind: 'follow', variantId: 'main', on: null, map: { UA: 'heavy' } })).toEqual(['main', 'heavy']);
		expect(variantsIn({ kind: 'follow', variantId: 'main', on: ['UA'], map: { UA: 'heavy' } })).toEqual(['heavy']);
	});

	it('is saved with pairs only between the routine’s Variants it follows and its own other Variants', () => {
		const f: Follow = { kind: 'follow', variantId: 'heavy', on: ['UA', 'UB'], map: { UA: 'heavy', UB: 'light', LA: 'light', gone: 'light', LB: 'deleted' } };
		expect(fitFollow(f, ['heavy', 'light'], ['UA', 'LA', 'UB', 'LB'])).toEqual({ kind: 'follow', variantId: 'heavy', on: ['UA', 'UB'], map: { UB: 'light' } });
		// The routine's Variants unknown: only its own Variants are checked.
		expect(fitFollow({ ...f, on: null }, ['heavy', 'light']).map).toEqual({ UB: 'light', LA: 'light', gone: 'light' });
		// Nothing left to pair: no map. A Variant it no longer has: its first.
		expect(fitFollow({ kind: 'follow', variantId: 'old', on: null, map: { UA: 'old' } }, ['heavy', 'light'], ['UA'])).toEqual({ kind: 'follow', variantId: 'heavy', on: null });
	});

	it('starts from the habit’s Variants with the routine’s names', () => {
		const routine = [{ id: 'UA', name: 'Upper A' }, { id: 'LA', name: 'Lower A' }, { id: 'X', name: 'Cardio' }];
		const own = [{ id: 'u', name: 'upper a ' }, { id: 'l', name: 'Lower A' }];
		expect(pairByName(routine, own)).toEqual({ UA: 'u', LA: 'l' });
	});

	it('runs through a phased routine with the Variant each phase brings up', () => {
		const phased: Schedule = {
			kind: 'phases',
			start: '2026-11-02',
			phases: [
				{ length: 1, unit: 'week', schedule: { kind: 'interval', every: 1, start: '2026-11-02', variantId: 'ramp' } },
				{ length: null, unit: 'week', schedule: { kind: 'weekly', days: { 0: 'UA', 2: 'UB' } } }
			]
		};
		const routineDue = (d: string) => dueOn(phased, [], d);
		const kid: Follow = { kind: 'follow', variantId: 'easy', on: null, map: { UA: 'heavy', UB: 'light' } };
		// Week 1 (Ramp-up) every day with its own; then Mon heavy, Wed light.
		expect(dueOn(kid, [], '2026-11-04', routineDue)).toBe('easy');
		expect(['2026-11-09', '2026-11-10', '2026-11-11'].map((d) => dueOn(kid, [], d, routineDue))).toEqual(['heavy', null, 'light']);
	});

	it('keeps its Variants when it stands on its own', () => {
		const m = (on: string[] | null, map: Record<string, string>): Follow => ({ kind: 'follow', variantId: 'main', on, map });
		expect(standaloneSchedule({ kind: 'weekly', days: { 0: 'UA', 2: 'UB', 4: 'LA' } }, m(['UA', 'UB'], { UA: 'heavy', UB: 'light' }), '2026-11-01')).toEqual({
			kind: 'weekly',
			days: { 0: 'heavy', 2: 'light' }
		});
		expect(standaloneSchedule({ kind: 'interval', every: 2, start: '2026-11-01', variantId: 'UA', rollup: { target: 1, minimum: null } }, m(null, { UA: 'heavy' }), '2026-11-10')).toEqual({
			kind: 'interval',
			every: 2,
			start: '2026-11-01',
			variantId: 'heavy'
		});
		const rot = {
			kind: 'rotation' as const,
			step: 'variant' as const,
			order: [
				{ variantId: 'UA', restDays: 1 },
				{ variantId: 'LA', restDays: 1 },
				{ variantId: 'UB', restDays: 1 },
				{ variantId: 'LB', restDays: 2 }
			],
			onMiss: 'wait' as const,
			weekdays: [],
			start: '2026-11-01',
			rollup: { target: null, minimum: 1 }
		};
		// Upper days only: Heavy, then Light, each with the Lower day after it as rest. The cycle stays 9 days.
		expect(standaloneSchedule(rot, m(['UA', 'UB'], { UA: 'heavy', UB: 'light' }), '2026-11-10')).toEqual({
			kind: 'rotation',
			step: 'variant',
			order: [
				{ variantId: 'heavy', restDays: 3 },
				{ variantId: 'light', restDays: 4 }
			],
			onMiss: 'wait',
			weekdays: [],
			start: '2026-11-01'
		});
		// All four paired one to one: the same rotation on its own Variants.
		const all = standaloneSchedule(rot, m(null, { UA: 'ua', LA: 'la', UB: 'ub', LB: 'lb' }), '2026-11-10');
		expect(all).toMatchObject({ kind: 'rotation', order: [{ variantId: 'ua', restDays: 1 }, { variantId: 'la', restDays: 1 }, { variantId: 'ub', restDays: 1 }, { variantId: 'lb', restDays: 2 }] });
		// A routine day it skips at the start of the order counts toward the last one it keeps.
		expect(standaloneSchedule(rot, m(['LA', 'LB'], { LA: 'a', LB: 'b' }), '2026-11-10')).toMatchObject({ order: [{ variantId: 'a', restDays: 3 }, { variantId: 'b', restDays: 4 }] });
		// By week: a rotation of its Variants, one a week, on the same weekdays.
		expect(standaloneSchedule({ ...rot, step: 'week', weekdays: [0, 3] }, m(null, { UA: 'heavy', LA: 'light', UB: 'heavy', LB: 'light' }), '2026-11-10')).toEqual({
			kind: 'rotation',
			step: 'week',
			order: [
				{ variantId: 'heavy', restDays: 0 },
				{ variantId: 'light', restDays: 0 },
				{ variantId: 'heavy', restDays: 0 },
				{ variantId: 'light', restDays: 0 }
			],
			onMiss: 'wait',
			weekdays: [0, 3],
			start: '2026-11-01'
		});
		// Phases: each phase turned the same way.
		const phased: Schedule = { kind: 'phases', start: '2026-11-02', phases: [{ length: 1, unit: 'week', schedule: { kind: 'weekly', days: { 0: 'UA', 2: 'UB' } } }, { length: null, unit: 'week', schedule: { kind: 'interval', every: 1, start: '2026-11-09', variantId: 'LA' } }] };
		expect(standaloneSchedule(phased, m(['UA', 'UB'], { UA: 'heavy', UB: 'light' }), '2026-11-02')).toEqual({
			kind: 'phases',
			start: '2026-11-02',
			phases: [
				{ length: 1, unit: 'week', schedule: { kind: 'weekly', days: { 0: 'heavy', 2: 'light' } } },
				{ length: null, unit: 'week', schedule: { kind: 'weekly', days: {} } }
			]
		});
	});
});
