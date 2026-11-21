import { describe, expect, it } from 'vitest';
import { dueOn, nextInRotation, type Done, type Rotation, type Schedule } from './schedule';
import { pickTask, type Candidate } from './fill';
import { buildStreak, daysSinceSlip, longestRun } from './streak';

// 2026-11-23 is a Monday.
const MON = '2026-11-23';

describe('weekly schedule', () => {
	const s: Schedule = { kind: 'weekly', days: { 0: 'A', 1: 'B', 2: 'C' } };
	it('puts the pinned Variant on its weekday', () => {
		expect(dueOn(s, [], MON)).toBe('A');
		expect(dueOn(s, [], '2026-11-24')).toBe('B');
		expect(dueOn(s, [], '2026-11-26')).toBeNull();
	});
});

describe('interval schedule', () => {
	const s: Schedule = { kind: 'interval', every: 3, start: MON, variantId: 'A' };
	it('is due every third day from the start', () => {
		expect(dueOn(s, [], MON)).toBe('A');
		expect(dueOn(s, [], '2026-11-25')).toBeNull();
		expect(dueOn(s, [], '2026-11-26')).toBe('A');
		expect(dueOn(s, [], '2026-11-22')).toBeNull();
	});
});

describe('frequency schedule', () => {
	const s: Schedule = { kind: 'frequency', times: 2, period: 'week', variantId: 'A' };
	it('stays due until done N times this week', () => {
		const h: Done[] = [{ date: MON, variantId: 'A', status: 'done' }];
		expect(dueOn(s, h, '2026-11-24')).toBe('A');
		h.push({ date: '2026-11-24', variantId: 'A', status: 'done' });
		expect(dueOn(s, h, '2026-11-25')).toBeNull();
		// A new week resets the count.
		expect(dueOn(s, h, '2026-11-30')).toBe('A');
	});
});

describe('rotation by Variant', () => {
	const order = [
		{ variantId: 'A', restDays: 2 },
		{ variantId: 'B', restDays: 1 },
		{ variantId: 'C', restDays: 1 }
	];
	const wait: Rotation = {
		kind: 'rotation',
		step: 'variant',
		order,
		onMiss: 'wait',
		weekdays: [],
		start: MON
	};
	const skip: Rotation = { ...wait, onMiss: 'skip' };

	it('starts with the first Variant on the start date', () => {
		expect(dueOn(wait, [], MON)).toBe('A');
	});

	it('respects the rest gap after a Variant', () => {
		const h: Done[] = [{ date: MON, variantId: 'A', status: 'done' }];
		expect(dueOn(wait, h, '2026-11-24')).toBeNull();
		expect(dueOn(wait, h, '2026-11-25')).toBeNull();
		expect(dueOn(wait, h, '2026-11-26')).toBe('B');
	});

	it('wait mode keeps a missed Variant due', () => {
		const h: Done[] = [{ date: MON, variantId: 'A', status: 'done' }];
		expect(dueOn(wait, h, '2026-11-28')).toBe('B');
	});

	it('skip mode moves on after a missed day', () => {
		const h: Done[] = [{ date: MON, variantId: 'A', status: 'done' }];
		// B was due on the 26th and missed; C follows after B's 1 rest day.
		expect(dueOn(skip, h, '2026-11-27')).toBeNull();
		expect(dueOn(skip, h, '2026-11-28')).toBe('C');
	});

	it('wraps around after the last Variant', () => {
		const h: Done[] = [{ date: MON, variantId: 'C', status: 'done' }];
		expect(nextInRotation(wait, h, '2026-11-24')).toEqual({
			variantId: 'A',
			dueFrom: '2026-11-25'
		});
	});

	it('a skip moves the rotation forward like a done', () => {
		const h: Done[] = [{ date: MON, variantId: 'A', status: 'skipped' }];
		expect(dueOn(wait, h, '2026-11-26')).toBe('B');
	});
});

describe('rotation by week', () => {
	const s: Schedule = {
		kind: 'rotation',
		step: 'week',
		order: [
			{ variantId: 'A', restDays: 0 },
			{ variantId: 'B', restDays: 0 }
		],
		onMiss: 'wait',
		weekdays: [0, 3],
		start: MON
	};
	it('alternates Variants each week on the chosen days', () => {
		expect(dueOn(s, [], MON)).toBe('A');
		expect(dueOn(s, [], '2026-11-26')).toBe('A');
		expect(dueOn(s, [], '2026-11-24')).toBeNull();
		expect(dueOn(s, [], '2026-11-30')).toBe('B');
		expect(dueOn(s, [], '2026-12-07')).toBe('A');
	});
});

describe('fill rules', () => {
	const library: Candidate[] = [
		{ id: 'dips', tags: { triceps: 3, chest: 2 }, lastDone: '2026-11-20' },
		{ id: 'pushdown', tags: { triceps: 3 }, lastDone: null },
		{ id: 'skullcrusher', tags: { triceps: 3, 'inner shoulders': 2 }, lastDone: '2026-11-01' },
		{ id: 'row', tags: { 'upper back': 3, triceps: 1 }, lastDone: null }
	];

	it('applies must and must-not rules', () => {
		const pick = pickTask({ must: { triceps: 2 }, mustNot: { chest: 1 } }, library, new Set(), () => 0);
		expect(['pushdown', 'skullcrusher']).toContain(pick);
	});

	it('prefers Tags, then the least recently done', () => {
		expect(pickTask({ must: { triceps: 2 }, prefer: ['inner shoulders'] }, library)).toBe(
			'skullcrusher'
		);
		expect(pickTask({ must: { triceps: 2 } }, library)).toBe('pushdown');
	});

	it('does not repeat a Task within one Occurrence', () => {
		expect(pickTask({ must: { triceps: 2 } }, library, new Set(['pushdown']))).toBe('skullcrusher');
	});

	it('returns null when nothing matches', () => {
		expect(pickTask({ must: { calves: 1 } }, library)).toBeNull();
	});
});

describe('streaks', () => {
	it('counts done back to the last miss; a skip adds nothing', () => {
		expect(buildStreak(['done', 'missed', 'done', 'skipped', 'done', 'due'])).toBe(2);
		expect(buildStreak([])).toBe(0);
	});

	it('resets the break-habit counter on a slip', () => {
		expect(daysSinceSlip([], '2026-11-01', '2026-11-20')).toBe(19);
		expect(daysSinceSlip(['2026-11-20'], '2026-11-01', '2026-11-20')).toBe(0);
		expect(daysSinceSlip(['2026-11-20'], '2026-11-01', '2026-11-21')).toBe(1);
	});

	it('finds the longest slip-free run', () => {
		// The counter reads 10 on the morning of Nov 11, resets with that day's slip, then reaches 4.
		expect(longestRun(['2026-11-11'], '2026-11-01', '2026-11-15')).toBe(10);
		expect(longestRun([], '2026-11-01', '2026-11-15')).toBe(14);
	});
});

// ---------- Atomic Habits additions ----------
import { streak, type Mark } from './streak';
import { makesLoop, orderByCue } from './stack';
import { topTriggers } from './triggers';

const STATUS: Record<string, Mark['status']> = { D: 'done', m: 'done', M: 'missed', S: 'skipped', _: 'due' };
/** One Mark per day from `start`: D done, m done at Minimum, M missed, S skipped, _ due. */
const marks = (seq: string, start = MON): Mark[] =>
	[...seq].map((c, i) => ({
		date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
		status: STATUS[c],
		level: c === 'm' ? 'minimum' : null
	}));

describe('streak rules', () => {
	it('strict: any miss resets', () => {
		expect(streak(marks('DDMDD'), { kind: 'strict' }).value).toBe(2);
	});

	it('never miss twice forgives a single miss', () => {
		expect(streak(marks('DDMDD'), { kind: 'neverTwice' }).value).toBe(4);
	});

	it('never miss twice ends at two misses in a row', () => {
		expect(streak(marks('DDMMD'), { kind: 'neverTwice' }).value).toBe(1);
		expect(streak(marks('DDMM'), { kind: 'neverTwice' }).value).toBe(0);
	});

	it('never miss twice flags the day after a miss', () => {
		const r = streak(marks('DDDM_'), { kind: 'neverTwice' });
		expect(r).toEqual({ value: 3, unit: 'streak', atRisk: true });
		expect(streak(marks('DDMD'), { kind: 'neverTwice' }).atRisk).toBe(false);
	});

	it('grace days allow N misses per week', () => {
		// MON..SUN: D M D M D: two misses in one week; one allowed.
		expect(streak(marks('DMDMD'), { kind: 'grace', misses: 1, period: 'week' }).value).toBe(2);
		expect(streak(marks('DMDMD'), { kind: 'grace', misses: 2, period: 'week' }).value).toBe(3);
	});

	it('consistency is the share done over the last N days, ignoring skips', () => {
		const r = streak(marks('DMDSD'), { kind: 'consistency', days: 30 }, { today: '2026-11-27' });
		expect(r).toEqual({ value: 75, unit: 'percent', atRisk: false });
	});

	it('a skip neither adds to the streak nor breaks it, under every rule', () => {
		// Done, then a skip: still 1, never 2.
		expect(streak(marks('DS'), { kind: 'strict' }).value).toBe(1);
		expect(streak(marks('DS'), { kind: 'neverTwice' }).value).toBe(1);
		expect(streak(marks('DS'), { kind: 'grace', misses: 1, period: 'week' }).value).toBe(1);
		// Skips can't build a streak from nothing.
		expect(streak(marks('SSS'), { kind: 'strict' }).value).toBe(0);
		// A skip between two done days doesn't break the run.
		expect(streak(marks('DSD'), { kind: 'strict' }).value).toBe(2);
	});

	it('never miss twice: a skip between two misses still makes two misses in a row', () => {
		expect(streak(marks('DDMSM'), { kind: 'neverTwice' }).value).toBe(0);
		expect(streak(marks('DDMS'), { kind: 'neverTwice' }).atRisk).toBe(true);
	});

	it('a Minimum keeps the streak unless the habit says otherwise', () => {
		expect(streak(marks('DmD'), { kind: 'strict' }).value).toBe(3);
		expect(streak(marks('DmD'), { kind: 'strict' }, { minimumCounts: false }).value).toBe(1);
	});
});

describe('stacking order', () => {
	it('orders by cue time and puts stacked habits after their anchor', () => {
		const out = orderByCue([
			{ id: 'read', time: null, afterId: 'coffee' },
			{ id: 'gym', time: '18:00', afterId: null },
			{ id: 'coffee', time: '07:00', afterId: null },
			{ id: 'stretch', time: null, afterId: 'gym' },
			{ id: 'misc', time: null, afterId: null }
		]).map((x) => x.id);
		expect(out).toEqual(['coffee', 'read', 'gym', 'stretch', 'misc']);
	});

	it('still shows habits stuck in a loop', () => {
		const out = orderByCue([
			{ id: 'a', time: null, afterId: 'b' },
			{ id: 'b', time: null, afterId: 'a' }
		]);
		expect(out).toHaveLength(2);
	});

	it('detects loops before saving', () => {
		const anchors = new Map<string, string | null>([
			['a', null],
			['b', 'a'],
			['c', 'b']
		]);
		expect(makesLoop('a', 'c', anchors)).toBe(true);
		expect(makesLoop('d', 'c', anchors)).toBe(false);
	});
});

describe('slip triggers', () => {
	const slip = (feeling: string | null, place: string | null, time: string | null) => ({
		count: 1,
		feeling,
		place,
		time,
		withWhom: null
	});
	it('reports the most common context once there are enough slips', () => {
		const top = topTriggers([
			slip('Bored', 'home', '22:30'),
			slip('Bored', 'home', '23:00'),
			slip('Stressed', 'work', '14:00'),
			slip('Bored', null, null)
		]);
		expect(top[0]).toEqual({ kind: 'feeling', label: 'bored', percent: 75 });
		expect(top.find((t) => t.kind === 'place')).toEqual({ kind: 'place', label: 'home', percent: 67 });
		expect(topTriggers([slip('Bored', null, null)])).toEqual([]);
	});
});

describe('streak labels', () => {
	it('shows nothing for consistency before there is any history', async () => {
		const { describeStreak } = await import('./streak');
		const rule = { kind: 'consistency', days: 30 } as const;
		expect(describeStreak(streak([], rule, { today: MON }), rule)).toBe('');
		expect(describeStreak(streak(marks('DM'), rule, { today: '2026-11-24' }), rule)).toBe('50% over 30 days');
	});
});

// ---------- P2 additions ----------
import { chainCells, forgivenMisses } from './chain';
import { limitOn, nextDrop, usedIn, withinOn, withinStreak, type Limit } from './limit';
import { hitsInARow, raise } from './progression';

describe('chain view', () => {
	it('marks single misses forgiven under never miss twice, double misses not', () => {
		const m = marks('DMDMMD');
		const f = forgivenMisses(m, { kind: 'neverTwice' });
		expect([...f]).toEqual(['2026-11-24']);
		expect(forgivenMisses(m, { kind: 'strict' }).size).toBe(0);
	});

	it('looks past skips when deciding whether a miss was forgiven', () => {
		// Miss, skip, miss: two misses in a row, so neither is forgiven.
		expect(forgivenMisses(marks('DMSMD'), { kind: 'neverTwice' }).size).toBe(0);
		expect([...forgivenMisses(marks('DMSD'), { kind: 'neverTwice' })]).toEqual(['2026-11-24']);
	});

	it('marks misses within the grace allowance', () => {
		const f = forgivenMisses(marks('MDMD'), { kind: 'grace', misses: 1, period: 'week' });
		expect([...f]).toEqual([MON]);
	});

	it('lays out one cell per day with rest days and the future', () => {
		const cells = chainCells(marks('Dm'), { kind: 'strict' }, MON, '2026-11-26', '2026-11-25');
		expect(cells.map((c) => c.cell.kind)).toEqual(['done', 'done', 'rest', 'future']);
		expect(cells[1].cell).toEqual({ kind: 'done', level: 'minimum' });
	});
});

describe('reduce mode', () => {
	const l: Limit = { max: 3, period: 'day', taper: { by: 1, every: 'week' }, start: MON };
	it('tapers the limit and never goes below zero', () => {
		expect(limitOn(l, MON)).toBe(3);
		expect(limitOn(l, '2026-11-30')).toBe(2);
		expect(limitOn(l, '2027-01-04')).toBe(0);
		expect(limitOn({ ...l, taper: { by: 1, every: 'month' } }, '2026-12-22')).toBe(3);
		expect(limitOn({ ...l, taper: { by: 1, every: 'month' } }, '2026-12-23')).toBe(2);
	});

	it('stops tapering at the floor and says when it drops next', () => {
		const floored: Limit = { ...l, taper: { by: 1, every: 'week', floor: 1 } };
		expect(limitOn(floored, '2027-01-04')).toBe(1);
		expect(nextDrop(l, MON)).toEqual({ date: '2026-11-30', max: 2 });
		expect(nextDrop(floored, '2026-12-07')).toBeNull();
		expect(nextDrop({ ...l, taper: null }, MON)).toBeNull();
	});

	it('counts days within the limit, back from today', () => {
		const slips = [
			{ date: MON, count: 5 },
			{ date: '2026-11-24', count: 2 },
			{ date: '2026-11-25', count: 3 }
		];
		const flat: Limit = { max: 3, period: 'day', taper: null, start: MON };
		expect(usedIn(flat, slips, '2026-11-25')).toBe(3);
		expect(withinStreak(flat, slips, MON, '2026-11-26')).toBe(3);
	});

	it('works per week too', () => {
		const week: Limit = { max: 10, period: 'week', taper: null, start: MON };
		const slips = [{ date: '2026-11-25', count: 11 }];
		expect(withinStreak(week, slips, MON, '2026-12-02')).toBe(1);
	});

	it('marks a day within a weekly limit until the week goes over', () => {
		// Up to 3 a week: 2 on Friday is fine, 1 on Saturday reaches 3, 1 on Sunday goes over.
		const week: Limit = { max: 3, period: 'week', taper: null, start: MON };
		const slips = [
			{ date: '2026-11-27', count: 2 },
			{ date: '2026-11-28', count: 1 },
			{ date: '2026-11-29', count: 1 },
			{ date: '2026-11-30', count: 1 }
		];
		expect(withinOn(week, slips, '2026-11-27')).toBe(true);
		expect(withinOn(week, slips, '2026-11-28')).toBe(true);
		expect(withinOn(week, slips, '2026-11-29')).toBe(false);
		// A new week starts from zero.
		expect(withinOn(week, slips, '2026-11-30')).toBe(true);
	});

	it('marks a day within a daily limit, following the taper', () => {
		const day: Limit = { max: 2, period: 'day', taper: { by: 1, every: 'week' }, start: MON };
		const slips = [
			{ date: MON, count: 2 },
			{ date: '2026-11-30', count: 2 }
		];
		expect(withinOn(day, slips, MON)).toBe(true);
		expect(withinOn(day, slips, '2026-11-30')).toBe(false);
	});
});

describe('progression', () => {
	it('counts hits at Target or better since the last raise', () => {
		expect(hitsInARow(marks('DDmDD'), null)).toBe(2);
		expect(hitsInARow(marks('DDSDD'), null)).toBe(4);
		expect(hitsInARow(marks('DDDD'), '2026-11-24')).toBe(2);
	});

	it('raises targets and always moves them up', () => {
		expect(raise({ a: 60, b: 8 }, { after: 3, by: 5, unit: 'percent' })).toEqual({ a: 63, b: 9 });
		expect(raise({ a: 60 }, { after: 3, by: 2.5, unit: 'amount' })).toEqual({ a: 62.5 });
	});
});
