// Phases: schedules one after another ("every day with Ramp-up for 1 week, then every day with
// Maintain"). Each phase runs from its own first day and only counts what was done in it.
import { describe, expect, it } from 'vitest';
import { dueOn, phaseOn, phaseSpans, planOn, historyOn, tidyPhases, variantsIn, NOTHING_DUE, type Done, type Phases, type Plain, type Schedule } from './schedule';
import { missedDays, recountFrom, scheduleStartBy, type DayRow } from './unlogged';
import { carriesOver, dependsOnHistory, variantFor } from './backfill';
import { standaloneSchedule } from './follow';
import { addDays } from './dates';

// 2026-11-16 is a Monday.
const START = '2026-11-16';
const daily = (v: string): Plain => ({ kind: 'weekly', days: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), v])) });
const rampThenMaintain: Phases = {
	kind: 'phases',
	start: START,
	phases: [
		{ length: 1, unit: 'week', schedule: daily('ramp') },
		{ length: null, unit: 'week', schedule: daily('keep') }
	]
};
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
const row = (date: string, status: DayRow['status'] = 'done', variantId: string | null = 'a'): DayRow => ({ date, status, variantId });
const done = (date: string, variantId: string): Done => ({ date, variantId, status: 'done' });

describe('phases', () => {
	it('run one after another: the first phase for its length, then the next', () => {
		expect(days(START, 7).map((d) => dueOn(rampThenMaintain, [], d))).toEqual(Array(7).fill('ramp'));
		expect(dueOn(rampThenMaintain, [], '2026-11-23')).toBe('keep');
		expect(dueOn(rampThenMaintain, [], '2027-03-01')).toBe('keep');
	});

	it('have nothing due before the start or after a last phase that ends', () => {
		const course: Phases = { kind: 'phases', start: START, phases: [{ length: 10, unit: 'day', schedule: daily('dose') }] };
		expect(dueOn(course, [], '2026-11-15')).toBeNull();
		expect(dueOn(course, [], '2026-11-25')).toBe('dose');
		expect(dueOn(course, [], '2026-11-26')).toBeNull();
		expect(planOn(course, '2026-11-26')).toEqual(NOTHING_DUE);
	});

	it('never reach phases after one with no end', () => {
		const s: Phases = { ...rampThenMaintain, phases: [{ length: null, unit: 'day', schedule: daily('a') }, { length: 3, unit: 'day', schedule: daily('b') }] };
		expect(phaseSpans(s)).toHaveLength(1);
		expect(dueOn(s, [], '2027-01-01')).toBe('a');
	});

	it('start every N days and rotations on the phase\'s first day', () => {
		const s: Phases = {
			kind: 'phases',
			start: START,
			phases: [
				{ length: 3, unit: 'day', schedule: daily('warm') },
				{ length: null, unit: 'day', schedule: { kind: 'interval', every: 2, start: '2020-01-01', variantId: 'x' } }
			]
		};
		// The second phase begins on Thursday 19th: due then, and every second day after.
		expect(days('2026-11-19', 5).map((d) => dueOn(s, [], d))).toEqual(['x', null, 'x', null, 'x']);
		expect(tidyPhases(s).phases[1].schedule).toMatchObject({ start: '2026-11-19' });
	});

	it('only count what was done in the phase: a rotation starts again, a weekly target counts afresh', () => {
		const s: Phases = {
			kind: 'phases',
			start: START,
			phases: [
				{ length: 3, unit: 'day', schedule: { kind: 'frequency', times: 2, period: 'week', variantId: 'a' } },
				{ length: null, unit: 'week', schedule: { kind: 'rotation', step: 'variant', order: [{ variantId: 'a', restDays: 0 }, { variantId: 'b', restDays: 0 }], onMiss: 'wait', weekdays: [], start: START } }
			]
		};
		// Two done in phase 1: its weekly target is met.
		const h = [done('2026-11-16', 'a'), done('2026-11-17', 'a')];
		expect(dueOn(s, h, '2026-11-18')).toBeNull();
		// Phase 2 starts on the 19th with its first Variant, whatever phase 1 did.
		expect(dueOn(s, h, '2026-11-19')).toBe('a');
		expect(dueOn(s, [...h, done('2026-11-19', 'a')], '2026-11-20')).toBe('b');
		expect(historyOn(s, h, '2026-11-19')).toEqual([]);
	});

	it('list every Variant they use', () => {
		expect(variantsIn(rampThenMaintain).sort()).toEqual(['keep', 'ramp']);
	});
});

describe('missed days in phases', () => {
	it('counts each phase by its own plan', () => {
		const misses = missedDays(rampThenMaintain, [row('2026-11-16', 'done', 'ramp')], START, START, '2026-11-24');
		expect(misses.map((m) => [m.date, m.variantId])).toEqual([
			...days('2026-11-17', 6).map((d) => [d, 'ramp']),
			['2026-11-23', 'keep'],
			['2026-11-24', 'keep']
		]);
	});

	it('asks a weekly target cut short by the end of a phase for its share', () => {
		// 4 a week, from Monday to Wednesday (3 of 7 days): owes 1. Then nothing is due.
		const s: Phases = { kind: 'phases', start: START, phases: [{ length: 3, unit: 'day', schedule: { kind: 'frequency', times: 4, period: 'week', variantId: 'a' } }] };
		expect(missedDays(s, [], START, START, '2026-11-22').map((m) => m.date)).toEqual(['2026-11-18']);
		expect(missedDays(s, [row('2026-11-17')], START, START, '2026-11-22')).toEqual([]);
	});

	it('asks a weekly target that starts part way through a week for its share', () => {
		// Phase 2 starts on Thursday: 4 a week owes floor(4 * 4 / 7) = 2 that week.
		const s: Phases = {
			kind: 'phases',
			start: START,
			phases: [
				{ length: 3, unit: 'day', schedule: daily('a') },
				{ length: null, unit: 'day', schedule: { kind: 'frequency', times: 4, period: 'week', variantId: 'b' } }
			]
		};
		const rows = days(START, 3).map((d) => row(d));
		expect(missedDays(s, rows, START, START, '2026-11-22').map((m) => [m.date, m.variantId])).toEqual([
			['2026-11-21', 'b'],
			['2026-11-22', 'b']
		]);
	});

	it('recounts a weekly target from no earlier than its phase\'s first day', () => {
		const s: Phases = {
			kind: 'phases',
			start: START,
			phases: [
				{ length: 3, unit: 'day', schedule: daily('a') },
				{ length: null, unit: 'day', schedule: { kind: 'frequency', times: 4, period: 'week', variantId: 'b' } }
			]
		};
		expect(recountFrom(s, '2026-11-21')).toBe('2026-11-19');
		expect(recountFrom(s, '2026-11-17')).toBeNull();
		expect(recountFrom(s, '2026-11-25')).toBe('2026-11-23');
	});

	it('keeps phases where they are when the habit starts earlier', () => {
		expect(scheduleStartBy(rampThenMaintain, '2026-11-01')).toBe(rampThenMaintain);
	});
});

describe('phases in the other schedule helpers', () => {
	const mixed: Phases = {
		kind: 'phases',
		start: START,
		phases: [
			{ length: 1, unit: 'week', schedule: { kind: 'frequency', times: 3, period: 'week', variantId: 'a' } },
			{ length: null, unit: 'week', schedule: daily('b') }
		]
	};

	it('carry over, and depend on history, by the phase in force', () => {
		expect(carriesOver(mixed, '2026-11-17')).toBe(true);
		expect(carriesOver(mixed, '2026-11-24')).toBe(false);
		// With no day: carries over only when every phase does; depends on history when any does.
		expect(carriesOver(mixed)).toBe(false);
		expect(dependsOnHistory(mixed)).toBe(true);
		expect(dependsOnHistory(mixed, '2026-11-24')).toBe(false);
	});

	it('give a day off the Variant of its phase', () => {
		const s: Phases = { kind: 'phases', start: START, phases: [{ length: 1, unit: 'week', schedule: { kind: 'weekly', days: { '0': 'a' } } }, { length: null, unit: 'week', schedule: { kind: 'weekly', days: { '0': 'b' } } }] };
		expect(variantFor(s, [], '2026-11-18', ['a', 'b'])).toBe('a');
		expect(variantFor(s, [], '2026-11-25', ['a', 'b'])).toBe('b');
		expect(variantFor(s, [], '2026-11-10', ['a', 'b'])).toBe('a');
	});

	it('turn a follower of a phased routine into phases of its own', () => {
		const parent: Schedule = { kind: 'phases', start: START, phases: [{ length: 1, unit: 'week', schedule: daily('base') }, { length: null, unit: 'week', schedule: daily('build') }] };
		const s = standaloneSchedule(parent, { kind: 'follow', variantId: 'mine', on: ['build'] }, START);
		expect(s.kind).toBe('phases');
		expect(dueOn(s, [], '2026-11-17')).toBeNull();
		expect(dueOn(s, [], '2026-11-24')).toBe('mine');
	});

	it('find the phase a day falls in', () => {
		expect(phaseOn(rampThenMaintain, '2026-11-22')).toMatchObject({ index: 0, from: START, to: '2026-11-22' });
		expect(phaseOn(rampThenMaintain, '2026-11-23')).toMatchObject({ index: 1, from: '2026-11-23', to: null });
	});
});
