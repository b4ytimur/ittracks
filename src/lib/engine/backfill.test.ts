import { describe, expect, it } from 'vitest';
import {
	carriesOver,
	dependsOnHistory,
	earliestLoggable,
	isRealDate,
	lastTimeFor,
	logWindow,
	variantFor
} from './backfill';
import { logicalDate } from './day';
import { dueOn, type Done, type Rotation, type Schedule } from './schedule';
import { streak, type Mark } from './streak';
import { chainCells, forgivenMisses } from './chain';
import { habitStats } from './stats';
import { isPaused } from './pause';

// 2026-11-23 is a Monday.
const MON = '2026-11-23';
const TUE = '2026-11-24';
const WED = '2026-11-25';
const THU = '2026-11-26';
const FRI = '2026-11-27';

/** Marks the way the app reads them: sorted by date, whenever each was logged. */
const byDate = (marks: Mark[]) => [...marks].sort((a, b) => a.date.localeCompare(b.date));

describe('which past days can be logged', () => {
	it('allows any past day by default, never today or the future', () => {
		expect(logWindow(THU, FRI, null)).toBe('ok');
		expect(logWindow('2020-01-01', FRI, null)).toBe('ok');
		expect(logWindow(FRI, FRI, null)).toBe('today');
		expect(logWindow('2026-11-28', FRI, null)).toBe('future');
	});

	it('limits how far back, counting yesterday as one day back', () => {
		expect(logWindow(THU, FRI, 1)).toBe('ok');
		expect(logWindow(WED, FRI, 1)).toBe('tooOld');
		expect(logWindow(MON, FRI, 4)).toBe('ok');
		expect(logWindow('2026-11-22', FRI, 4)).toBe('tooOld');
		expect(earliestLoggable(FRI, 4)).toBe(MON);
		expect(earliestLoggable(FRI, null)).toBeNull();
	});

	it('can be switched off', () => {
		expect(logWindow(THU, FRI, 0)).toBe('off');
		expect(logWindow(FRI, FRI, 0)).toBe('today');
	});

	it('follows the day start: at 01:30 with a 04:00 start, yesterday is two calendar days back', () => {
		const today = logicalDate('2026-11-27', '01:30', '04:00');
		expect(today).toBe(THU);
		expect(logWindow(WED, today, 1)).toBe('ok');
		expect(logWindow(TUE, today, 1)).toBe('tooOld');
		// The calendar date is still "today" for the logical day before it, so it can't be backfilled.
		expect(logWindow(FRI, today, null)).toBe('future');
	});

	it('only takes real dates', () => {
		expect(isRealDate('2026-11-27')).toBe(true);
		expect(isRealDate('2026-02-30')).toBe(false);
		expect(isRealDate('2026-11-27x')).toBe(false);
		expect(isRealDate('yesterday')).toBe(false);
	});
});

describe('the Variant a past day gets', () => {
	it('is the one the schedule had due that day', () => {
		const s: Schedule = { kind: 'weekly', days: { 0: 'A', 2: 'B' } };
		expect(variantFor(s, [], MON, ['A', 'B'])).toBe('A');
		expect(variantFor(s, [], WED, ['A', 'B'])).toBe('B');
	});

	it('on a day off, the Variant of the last scheduled weekday', () => {
		const s: Schedule = { kind: 'weekly', days: { 0: 'A', 2: 'B' } };
		expect(variantFor(s, [], TUE, ['A', 'B'])).toBe('A');
		expect(variantFor(s, [], FRI, ['A', 'B'])).toBe('B');
	});

	it('uses the only Variant of a frequency or interval schedule, even when the target was met', () => {
		const f: Schedule = { kind: 'frequency', times: 1, period: 'week', variantId: 'A' };
		const met: Done[] = [{ date: MON, variantId: 'A', status: 'done' }];
		expect(dueOn(f, met, WED)).toBeNull();
		expect(variantFor(f, met, WED, ['A'])).toBe('A');
		expect(variantFor({ kind: 'interval', every: 3, start: MON, variantId: 'A' }, [], TUE, ['A'])).toBe('A');
	});

	it('follows a rotation: the next Variant after what was done before that day', () => {
		const r: Rotation = {
			kind: 'rotation',
			step: 'variant',
			order: [
				{ variantId: 'A', restDays: 1 },
				{ variantId: 'B', restDays: 1 }
			],
			onMiss: 'wait',
			weekdays: [],
			start: MON
		};
		const past: Done[] = [{ date: MON, variantId: 'A', status: 'done' }];
		// Tuesday is a rest day; logging it anyway gives the next Variant.
		expect(dueOn(r, past, TUE)).toBeNull();
		expect(variantFor(r, past, TUE, ['A', 'B'])).toBe('B');
		expect(variantFor(r, past, WED, ['A', 'B'])).toBe('B');
	});

	it('in a rotation by week, the Variant of that week, even on a day off', () => {
		const r: Rotation = {
			kind: 'rotation',
			step: 'week',
			order: [
				{ variantId: 'A', restDays: 0 },
				{ variantId: 'B', restDays: 0 }
			],
			onMiss: 'wait',
			weekdays: [0, 2],
			start: MON
		};
		expect(variantFor(r, [], TUE, ['A', 'B'])).toBe('A');
		expect(variantFor(r, [], '2026-12-01', ['A', 'B'])).toBe('B');
	});

	it('knows which schedules carry over and which a past log can change', () => {
		const f: Schedule = { kind: 'frequency', times: 2, period: 'week', variantId: 'A' };
		const w: Schedule = { kind: 'weekly', days: { 0: 'A' } };
		const skip: Rotation = { kind: 'rotation', step: 'variant', order: [{ variantId: 'A', restDays: 0 }], onMiss: 'skip', weekdays: [], start: MON };
		expect([carriesOver(f), dependsOnHistory(f)]).toEqual([true, true]);
		expect([carriesOver(w), dependsOnHistory(w)]).toEqual([false, false]);
		expect([carriesOver(skip), dependsOnHistory(skip)]).toEqual([false, true]);
	});
});

describe('a past log counts like one made on the day', () => {
	it('never miss twice: logging one of two misses late brings the streak back', () => {
		const before = byDate([
			{ date: MON, status: 'done' },
			{ date: TUE, status: 'missed' },
			{ date: WED, status: 'missed' }
		]);
		expect(streak(before, { kind: 'neverTwice' }).value).toBe(0);
		const after = byDate([
			{ date: MON, status: 'done' },
			{ date: TUE, status: 'done' },
			{ date: WED, status: 'missed' }
		]);
		const r = streak(after, { kind: 'neverTwice' });
		expect(r.value).toBe(2);
		// The newest is still a miss, so the next one decides.
		expect(r.atRisk).toBe(true);
	});

	it('a day the app was never opened has no mark; logging it later adds to the streak', () => {
		const gap = byDate([
			{ date: MON, status: 'done' },
			{ date: WED, status: 'done' }
		]);
		expect(streak(gap, { kind: 'strict' }).value).toBe(2);
		const filled = byDate([...gap, { date: TUE, status: 'done' }]);
		expect(streak(filled, { kind: 'strict' }).value).toBe(3);
	});

	it('the order logs were made in does not matter, only their dates', () => {
		const late = [
			{ date: WED, status: 'done' as const },
			{ date: THU, status: 'missed' as const },
			{ date: MON, status: 'done' as const },
			{ date: TUE, status: 'done' as const }
		];
		expect(streak(byDate(late), { kind: 'grace', misses: 1, period: 'week' }).value).toBe(3);
		expect(streak(byDate(late), { kind: 'consistency', days: 7 }, { today: THU }).value).toBe(75);
	});

	it('the chain shows the forgiven miss once the miss before it is logged late', () => {
		const before = byDate([
			{ date: MON, status: 'done' },
			{ date: TUE, status: 'missed' },
			{ date: WED, status: 'missed' }
		]);
		expect([...forgivenMisses(before, { kind: 'neverTwice' })]).toEqual([]);
		const after = byDate([
			{ date: MON, status: 'done' },
			{ date: TUE, status: 'done', level: 'minimum' },
			{ date: WED, status: 'missed' }
		]);
		const cells = chainCells(after, { kind: 'neverTwice' }, MON, WED, THU);
		expect(cells.map((c) => c.cell)).toEqual([
			{ kind: 'done', level: 'target' },
			{ kind: 'done', level: 'minimum' },
			{ kind: 'missed', forgiven: true }
		]);
	});

	it('stats count it too', () => {
		const s = habitStats(byDate([{ date: TUE, status: 'done' }, { date: WED, status: 'done' }]), THU);
		expect(s.week).toBe(2);
		expect(s.lastDone).toBe(WED);
	});

	it('a weekly target met by a late log means today is no longer due', () => {
		const f: Schedule = { kind: 'frequency', times: 2, period: 'week', variantId: 'A' };
		const known: Done[] = [{ date: MON, variantId: 'A', status: 'done' }];
		expect(dueOn(f, known, THU)).toBe('A');
		expect(dueOn(f, [...known, { date: WED, variantId: 'A', status: 'done' }], THU)).toBeNull();
	});

	it('a waiting rotation moves on when the day it waited for is logged late', () => {
		const r: Rotation = {
			kind: 'rotation',
			step: 'variant',
			order: [
				{ variantId: 'A', restDays: 1 },
				{ variantId: 'B', restDays: 1 }
			],
			onMiss: 'wait',
			weekdays: [],
			start: MON
		};
		const known: Done[] = [{ date: MON, variantId: 'A', status: 'done' }];
		// B was due Wednesday and is still waiting on Thursday.
		expect(dueOn(r, known, THU)).toBe('B');
		// B was done Wednesday after all: Thursday rests, A comes back Friday.
		const late = [...known, { date: WED, variantId: 'B', status: 'done' as const }];
		expect(dueOn(r, late, THU)).toBeNull();
		expect(dueOn(r, late, FRI)).toBe('A');
	});

	it('a paused day is never due, so logging it is an extra', () => {
		const pauses = [{ habitId: null, start: TUE, end: WED }];
		expect(isPaused(pauses, 'h', TUE)).toBe(true);
		expect(isPaused(pauses, 'h', THU)).toBe(false);
	});
});

describe('"Same as last time" on a past day', () => {
	const done = [
		{ id: 'fri', date: FRI },
		{ id: 'wed', date: WED },
		{ id: 'mon', date: MON }
	];

	it('copies the latest log on or before that day, not a newer one', () => {
		expect(lastTimeFor(done, { id: 'thu', date: THU })?.id).toBe('wed');
		expect(lastTimeFor(done, { id: 'tue', date: TUE })?.id).toBe('mon');
	});

	it('today copies the newest, as before', () => {
		expect(lastTimeFor(done, { id: 'sat', date: '2026-11-28' })?.id).toBe('fri');
	});

	it('falls back to the newest when nothing is older, and never copies itself', () => {
		expect(lastTimeFor(done, { id: 'sun', date: '2026-11-22' })?.id).toBe('fri');
		expect(lastTimeFor(done, { id: 'wed', date: WED })?.id).toBe('mon');
		expect(lastTimeFor([{ id: 'wed', date: WED }], { id: 'wed', date: WED })).toBeUndefined();
	});
});
