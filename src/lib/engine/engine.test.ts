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
		// Counter peaks at 9 on Nov 10, resets on Nov 11, then reaches 4 on Nov 15.
		expect(longestRun(['2026-11-11'], '2026-11-01', '2026-11-15')).toBe(9);
		expect(longestRun([], '2026-11-01', '2026-11-15')).toBe(14);
	});
});
