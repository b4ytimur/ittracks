import { describe, expect, it } from 'vitest';
import { keepEarlier, missedDays, missedDaysOver, recountFrom, scheduleOn, scheduleStartBy, type DayRow } from './unlogged';
import { dueOn, nextInRotation, type Rotation, type Schedule } from './schedule';
import { chainCells } from './chain';
import { streak } from './streak';
import { duplicateRange } from './day';
import { addDays } from './dates';

// 2026-11-16 is a Monday.
const dates = (ms: { date: string }[]) => ms.map((m) => m.date);
const row = (date: string, status: DayRow['status'] = 'done', variantId: string | null = 'a', extra = false): DayRow => ({
	date,
	status,
	variantId,
	extra
});

describe('due days nobody logged', () => {
	const weekly: Schedule = { kind: 'weekly', days: { '0': 'a', '2': 'a', '4': 'a' } }; // Mon, Wed, Fri

	it('counts every due day with no log as a miss, and nothing else', () => {
		const misses = missedDays(weekly, [row('2026-11-16')], '2026-11-01', '2026-11-16', '2026-11-22');
		expect(dates(misses)).toEqual(['2026-11-18', '2026-11-20']);
		expect(misses[0].variantId).toBe('a');
	});

	it('leaves out days before the start, paused days and days that already have a row', () => {
		const misses = missedDays(
			weekly,
			[row('2026-11-20', 'skipped')],
			'2026-11-17',
			'2026-11-01',
			'2026-11-22',
			(d) => d === '2026-11-18'
		);
		expect(misses).toEqual([]);
	});

	it('follows every few days from its start', () => {
		const s: Schedule = { kind: 'interval', every: 3, start: '2026-11-16', variantId: 'a' };
		expect(dates(missedDays(s, [], '2026-11-16', '2026-11-16', '2026-11-25'))).toEqual(['2026-11-16', '2026-11-19', '2026-11-22', '2026-11-25']);
	});

	it('counts the missing sessions of a week that ended short, on its last free days', () => {
		const s: Schedule = { kind: 'frequency', times: 3, period: 'week', variantId: 'a' };
		const rows = [row('2026-11-09'), row('2026-11-16'), row('2026-11-17', 'skipped'), row('2026-11-22')];
		const misses = missedDays(s, rows, '2026-11-01', '2026-11-09', '2026-11-22');
		// Week of Nov 9: 1 done, 2 missing. Week of Nov 16: done, skip and done make 3.
		expect(dates(misses)).toEqual(['2026-11-14', '2026-11-15']);
	});

	it('does not count the current week before it ends, or a session twice', () => {
		const s: Schedule = { kind: 'frequency', times: 2, period: 'week', variantId: 'a' };
		expect(missedDays(s, [], '2026-11-01', '2026-11-16', '2026-11-21')).toEqual([]);
		const once = missedDays(s, [row('2026-11-10')], '2026-11-01', '2026-11-09', '2026-11-15');
		expect(dates(once)).toEqual(['2026-11-15']);
		const again = missedDays(s, [row('2026-11-10'), row('2026-11-15', 'missed')], '2026-11-01', '2026-11-09', '2026-11-15');
		expect(again).toEqual([]);
	});

	it('asks a first week that started late for its share of the sessions, rounded down', () => {
		const s: Schedule = { kind: 'frequency', times: 3, period: 'week', variantId: 'a' };
		// Started on Saturday: 3 × 2/7 rounds down to nothing owed.
		expect(missedDays(s, [], '2026-11-21', '2026-11-21', '2026-11-22')).toEqual([]);
		// "4 a week" started on a Sunday owes nothing for that one day.
		expect(missedDays({ ...s, times: 4 }, [], '2026-11-22', '2026-11-22', '2026-11-22')).toEqual([]);
		// Started on a Thursday: 4 days left, 3 × 4/7 is 1 session, done on Friday.
		expect(missedDays(s, [row('2026-11-20')], '2026-11-19', '2026-11-19', '2026-11-22')).toEqual([]);
		expect(dates(missedDays(s, [], '2026-11-19', '2026-11-19', '2026-11-22'))).toEqual(['2026-11-22']);
		// The next full week asks for all 3 again.
		expect(dates(missedDays(s, [], '2026-11-19', '2026-11-23', '2026-11-29'))).toEqual(['2026-11-27', '2026-11-28', '2026-11-29']);
	});

	it('counts a month target when the month is over', () => {
		const s: Schedule = { kind: 'frequency', times: 2, period: 'month', variantId: 'a' };
		expect(dates(missedDays(s, [row('2026-10-03')], '2026-10-01', '2026-10-01', '2026-11-05'))).toEqual(['2026-10-31']);
	});

	it('counts one miss each time a waiting rotation comes round again without it', () => {
		const s: Rotation = {
			kind: 'rotation',
			step: 'variant',
			order: [
				{ variantId: 'a', restDays: 1 },
				{ variantId: 'b', restDays: 1 }
			],
			onMiss: 'wait',
			weekdays: [],
			start: '2026-11-16'
		};
		// A done Monday, so B is due Wednesday, and waits: Wed, Fri and Sun are missed sessions.
		const misses = missedDays(s, [row('2026-11-16', 'done', 'a')], '2026-11-16', '2026-11-16', '2026-11-22');
		expect(misses).toEqual([
			{ date: '2026-11-18', variantId: 'b' },
			{ date: '2026-11-20', variantId: 'b' },
			{ date: '2026-11-22', variantId: 'b' }
		]);
	});

	it('counts each day a rotation that skips ahead had due', () => {
		const s: Rotation = {
			kind: 'rotation',
			step: 'variant',
			order: [
				{ variantId: 'a', restDays: 0 },
				{ variantId: 'b', restDays: 2 }
			],
			onMiss: 'skip',
			weekdays: [],
			start: '2026-11-16'
		};
		expect(missedDays(s, [], '2026-11-16', '2026-11-16', '2026-11-21')).toEqual([
			{ date: '2026-11-16', variantId: 'a' },
			{ date: '2026-11-17', variantId: 'b' },
			{ date: '2026-11-20', variantId: 'a' },
			{ date: '2026-11-21', variantId: 'b' }
		]);
	});

	it('makes streaks and consistency see the gap', () => {
		const rows = [row('2026-11-16'), row('2026-11-20')];
		const marks = [...rows, ...missedDays(weekly, rows, '2026-11-16', '2026-11-16', '2026-11-20').map((m) => ({ ...m, status: 'missed' as const }))].sort(
			(a, b) => a.date.localeCompare(b.date)
		);
		expect(streak(marks, { kind: 'strict' }).value).toBe(1);
		expect(streak(marks, { kind: 'consistency', days: 7 }, { today: '2026-11-20' }).value).toBe(67);
	});

	it('says from where to count again after a past day changes', () => {
		expect(recountFrom({ kind: 'frequency', times: 3, period: 'week', variantId: 'a' }, '2026-11-19')).toBe('2026-11-16');
		expect(recountFrom({ kind: 'frequency', times: 3, period: 'month', variantId: 'a' }, '2026-11-19')).toBe('2026-11-01');
		expect(recountFrom(weekly, '2026-11-19')).toBeNull();
	});
});

describe('starting a habit earlier', () => {
	it('moves every few days back by whole cycles, so planned days stay', () => {
		const s: Schedule = { kind: 'interval', every: 3, start: '2026-11-20', variantId: 'a' };
		const moved = scheduleStartBy(s, '2026-11-15');
		expect(moved).toMatchObject({ start: '2026-11-14' });
		expect(dueOn(moved, [], '2026-11-20')).toBe('a');
		expect(dueOn(moved, [], '2026-11-15')).toBeNull();
	});

	it('moves a weekly rotation back by whole turns, so this week keeps its Variant', () => {
		const s: Rotation = {
			kind: 'rotation',
			step: 'week',
			order: [
				{ variantId: 'a', restDays: 0 },
				{ variantId: 'b', restDays: 0 }
			],
			onMiss: 'wait',
			weekdays: [0],
			start: '2026-11-16'
		};
		const moved = scheduleStartBy(s, '2026-11-10');
		expect(moved.start).toBe('2026-11-02');
		expect(dueOn(moved, [], '2026-11-16')).toBe('a');
		expect(dueOn(moved, [], '2026-11-09')).toBe('b');
	});

	it('moves a roster (a rotation by Variant) back by whole cycles, so every planned day keeps its Variant', () => {
		// Off 1..Off 7 with rests 0/0/0/2/0/0/3: a 12-day cycle, anchored on Nov 5.
		const rests = [0, 0, 0, 2, 0, 0, 3];
		const s: Rotation = {
			kind: 'rotation',
			step: 'variant',
			order: rests.map((r, i) => ({ variantId: `off${i + 1}`, restDays: r })),
			onMiss: 'skip',
			weekdays: [],
			start: '2026-11-05'
		};
		const moved = scheduleStartBy(s, '2026-11-02');
		expect(moved.start).toBe('2026-10-24');
		for (let d = '2026-11-05'; d <= '2026-11-30'; d = addDays(d, 1)) expect(dueOn(moved, [], d)).toBe(dueOn(s, [], d));
		expect(dueOn(moved, [], '2026-11-02')).toBeNull();
	});

	it('leaves a schedule alone when it already starts in time', () => {
		const s: Schedule = { kind: 'interval', every: 2, start: '2026-11-01', variantId: 'a' };
		expect(scheduleStartBy(s, '2026-11-10')).toBe(s);
		expect(scheduleStartBy(weeklyOf(), '2026-11-10')).toEqual(weeklyOf());
	});
});

function weeklyOf(): Schedule {
	return { kind: 'weekly', days: { '0': 'a' } };
}

describe('a rotation that skips ahead runs like a roster', () => {
	const roster: Rotation = {
		kind: 'rotation',
		step: 'variant',
		order: [
			{ variantId: 'day', restDays: 0 },
			{ variantId: 'night', restDays: 2 }
		],
		onMiss: 'skip',
		weekdays: [],
		start: '2026-11-16'
	};

	it('keeps its calendar when an extra is logged on a day off', () => {
		const history = [
			{ date: '2026-11-16', variantId: 'day', status: 'done' as const },
			{ date: '2026-11-18', variantId: 'day', status: 'done' as const, extra: true }
		];
		// Night on the 17th, then 2 days off, so Day again on the 20th.
		expect(nextInRotation(roster, history, '2026-11-19')).toEqual({ variantId: 'day', dueFrom: '2026-11-20' });
	});

	it('still moves a waiting rotation on, which follows what you do', () => {
		const wait: Rotation = { ...roster, onMiss: 'wait' };
		const history = [{ date: '2026-11-18', variantId: 'day', status: 'done' as const, extra: true }];
		expect(nextInRotation(wait, history, '2026-11-19')).toEqual({ variantId: 'night', dueFrom: '2026-11-19' });
	});
});

describe('the chain', () => {
	it('tells days before the start and unlogged due days apart from days off', () => {
		const cells = chainCells([], { kind: 'strict' }, '2026-11-14', '2026-11-17', '2026-11-21', {
			start: '2026-11-15',
			unlogged: new Set(['2026-11-16'])
		});
		expect(cells.map((c) => c.cell.kind)).toEqual(['before', 'rest', 'unlogged', 'rest']);
	});
});

describe('parts of the day', () => {
	it('finds a name used twice, whatever its case', () => {
		const f = new FormData();
		for (const n of ['Morning', 'Evening', ' morning ']) f.append('rangeName', n);
		expect(duplicateRange(f)).toBe('morning');
		const ok = new FormData();
		for (const n of ['Morning', 'Evening', '']) ok.append('rangeName', n);
		expect(duplicateRange(ok)).toBeNull();
	});
});

describe('a schedule edit that applies from today on', () => {
	const weekdays: Schedule = { kind: 'weekly', days: { '0': 'a', '1': 'a', '2': 'a', '3': 'a', '4': 'a' } };
	const everyDay: Schedule = { kind: 'weekly', days: { '0': 'a', '1': 'a', '2': 'a', '3': 'a', '4': 'a', '5': 'a', '6': 'a' } };

	it('keeps the old plan for the days before the edit', () => {
		const earlier = keepEarlier(null, weekdays, '2026-11-02', '2026-11-21');
		expect(earlier).toEqual([{ until: '2026-11-20', schedule: weekdays }]);
		expect(scheduleOn(everyDay, earlier, '2026-11-14')).toBe(weekdays);
		expect(scheduleOn(everyDay, earlier, '2026-11-21')).toBe(everyDay);
		// Weekends before the edit were never due, so recounting them writes no misses.
		const misses = missedDaysOver(everyDay, earlier, [], '2026-11-02', '2026-11-09', '2026-11-22');
		expect(dates(misses).filter((d) => d < '2026-11-21')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
		expect(dates(misses).filter((d) => d >= '2026-11-21')).toEqual(['2026-11-21', '2026-11-22']);
	});

	it('records a day once: a second edit on the same day keeps the plan yesterday had', () => {
		const once = keepEarlier(null, weekdays, '2026-11-02', '2026-11-21');
		expect(keepEarlier(once, everyDay, '2026-11-02', '2026-11-21')).toEqual(once);
		// A habit that starts today has no past to keep.
		expect(keepEarlier(null, weekdays, '2026-11-21', '2026-11-21')).toBeNull();
	});
});
