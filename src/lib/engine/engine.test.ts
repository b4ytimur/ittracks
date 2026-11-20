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
	it('counts done and skipped back to the last miss', () => {
		expect(buildStreak(['done', 'missed', 'done', 'skipped', 'done', 'due'])).toBe(3);
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
