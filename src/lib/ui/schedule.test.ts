// The schedule editor's rules, shared by the habit's own schedule and each of its phases.
import { describe, expect, it } from 'vitest';
import { addPhase, fitVariants, phaseDates, plainOfKind, removePhase, savedPlain, type PhaseRow } from './schedule';
import { describeSchedule } from '../describe';
import type { ScheduleForm } from '../forms';

const A = { id: 'a', name: 'Ramp-up' };
const B = { id: 'b', name: 'Maintain' };

describe('schedule editor', () => {
	it('makes a schedule of another kind keeping the Variant and the start', () => {
		const from = { kind: 'interval' as const, every: 2, start: '2026-11-03', variantId: 'b' };
		expect(plainOfKind('frequency', from, [A, B], '2026-11-01')).toEqual({ kind: 'frequency', times: 3, period: 'week', variantId: 'b' });
		expect(plainOfKind('rotation', from, [A, B], '2026-11-01')).toMatchObject({ start: '2026-11-03', order: [{ variantId: 'a' }, { variantId: 'b' }] });
		expect(plainOfKind('weekly', null, [A], '2026-11-01')).toEqual({ kind: 'weekly', days: { '0': 'a', '2': 'a', '4': 'a' } });
	});

	it('keeps only Variants the habit has; a rotation follows the habit\'s order', () => {
		expect(fitVariants({ kind: 'weekly', days: { '0': 'a', '1': 'gone' } }, [A, B], true)).toEqual({ kind: 'weekly', days: { '0': 'a' } });
		expect(fitVariants({ kind: 'frequency', times: 2, period: 'week', variantId: 'gone' }, [A, B], true)).toMatchObject({ variantId: 'a' });
		const rot = { kind: 'rotation' as const, step: 'variant' as const, onMiss: 'wait' as const, weekdays: [3], start: '2026-11-01', order: [{ variantId: 'b', restDays: 2 }] };
		// The habit's own rotation goes through every Variant; a phase's keeps the ones it picked.
		expect(fitVariants(rot, [A, B], true)).toMatchObject({ weekdays: [3], order: [{ variantId: 'a', restDays: 1 }, { variantId: 'b', restDays: 2 }] });
		// Saved, a rotation by Variant has no weekdays; the editor keeps them for switching to weeks.
		expect(savedPlain(rot, [A, B], true)).toMatchObject({ weekdays: [] });
		expect(savedPlain({ ...rot, step: 'week', weekdays: [4, 0] }, [A, B], true)).toMatchObject({ weekdays: [0, 4] });
		expect(fitVariants(rot, [A, B], false)).toMatchObject({ order: [{ variantId: 'b', restDays: 2 }] });
		expect(fitVariants({ ...rot, order: [{ variantId: 'gone', restDays: 0 }] }, [A, B], false)).toMatchObject({ order: [{ variantId: 'a', restDays: 1 }] });
	});

	it('adds a phase that runs on with no end, giving the one before it a length', () => {
		const daily = { kind: 'weekly' as const, days: { '0': 'a' } };
		const rows: PhaseRow[] = [{ key: 'p0', length: null, unit: 'week', schedule: daily }];
		const next = addPhase(rows, 'p1', daily);
		expect(next.map((r) => [r.key, r.length, r.unit])).toEqual([
			['p0', 1, 'week'],
			['p1', null, 'week']
		]);
		expect(next[1].schedule).toEqual(daily);
		expect(next[1].schedule).not.toBe(daily);
	});

	it('removes a phase the other way round: the one before a removed open-ended last phase runs on', () => {
		const daily = { kind: 'weekly' as const, days: { '0': 'a' } };
		const rows = addPhase([{ key: 'p0', length: 2, unit: 'week', schedule: daily }], 'p1', daily);
		expect(removePhase(rows, 'p1').map((r) => r.length)).toEqual([null]);
		expect(removePhase(rows, 'p0').map((r) => [r.key, r.length])).toEqual([['p1', null]]);
		expect(removePhase([rows[0]], 'p0')).toHaveLength(1);
	});

	it('shows the days each phase runs', () => {
		const daily = { kind: 'weekly' as const, days: { '0': 'a' } };
		expect(
			phaseDates('2026-11-16', [
				{ length: 10, unit: 'day', schedule: daily },
				{ length: null, unit: 'week', schedule: daily },
				{ length: 1, unit: 'week', schedule: daily }
			])
		).toEqual([
			{ from: '2026-11-16', to: '2026-11-25' },
			{ from: '2026-11-26', to: null },
			{ from: null, to: null }
		]);
	});

	it('describes phases in one line, with Variant names when there are several', () => {
		const every = (v: string) => ({ kind: 'interval' as const, every: 1, start: '2026-11-16', variantId: v });
		const s: ScheduleForm = {
			kind: 'phases',
			start: '2026-11-16',
			phases: [
				{ length: 1, unit: 'week', schedule: every('a') },
				{ length: null, unit: 'week', schedule: every('b') }
			]
		};
		expect(describeSchedule(s, undefined, [A, B])).toBe('Every day (Ramp-up) for 1 week, then every day (Maintain)');
		expect(describeSchedule({ ...s, phases: [{ length: 10, unit: 'day', schedule: every('a') }] }, undefined, [A])).toBe('Every day for 10 days, then it ends');
	});

	it('reads a habit that follows its routine with the Variant each of the routine’s brings up', () => {
		const parent = { name: 'Gym day', variants: [{ id: 'ua', name: 'Upper A' }, { id: 'la', name: 'Lower A' }, { id: 'ub', name: 'Upper B' }] };
		const own = [{ id: 'h', name: 'Heavy' }, { id: 'l', name: 'Light' }];
		expect(describeSchedule({ kind: 'follow', variantId: 'h', on: ['ua', 'ub'], map: { ub: 'l' } }, parent, own)).toBe('When Gym day is due with Upper A or Upper B (Heavy on Upper A, Light on Upper B)');
		expect(describeSchedule({ kind: 'follow', variantId: 'h', on: null, map: { ub: 'l' } }, parent, own)).toBe('Whenever Gym day is due (Heavy on Upper A, Heavy on Lower A, Light on Upper B)');
		const same = [{ id: 'x', name: 'Upper A' }, { id: 'y', name: 'Lower A' }, { id: 'z', name: 'Upper B' }];
		expect(describeSchedule({ kind: 'follow', variantId: 'x', on: null, map: { la: 'y', ub: 'z' } }, parent, same)).toBe('Whenever Gym day is due, with the Variant of the same name');
		expect(describeSchedule({ kind: 'follow', variantId: 'h', on: null }, parent, own)).toBe('Whenever Gym day is due');
	});
});
