import { describe, expect, it } from 'vitest';
import { habitForm, taskForm, type HabitForm, type TaskForm } from '../forms';
import { blocked, get, set } from './core';
import { checkHabit, habitRules, slotRules } from './habit';
import { checkTask, metricRules } from './task';
import { overlappingRanges } from './settings';

const V = '00000000-0000-4000-8000-000000000001';
const S = '00000000-0000-4000-8000-000000000002';
const T = '00000000-0000-4000-8000-000000000003';
const M = '00000000-0000-4000-8000-000000000004';
const H = '00000000-0000-4000-8000-000000000005';

const base = (): HabitForm =>
	habitForm.parse({
		name: 'Run',
		direction: 'build',
		startDate: '2026-11-01',
		variants: [{ id: V, name: 'A', slots: [{ id: S, taskId: T, fillRule: null, sets: null, targets: { [M]: 5 } }] }],
		schedule: { kind: 'frequency', times: 3, period: 'week', variantId: V }
	});

const task = (): TaskForm =>
	taskForm.parse({
		name: 'Bench',
		restTimerEnabled: true,
		restTimerSeconds: 90,
		tags: [],
		metrics: [{ id: M, name: 'Reps', type: 'count', repeats: true }],
		subtasks: []
	});

/**
 * A value for each side of every exclusive or requiresAny rule, so each rule gets a test
 * automatically. A new rule without a sample here fails the "has samples" test.
 */
const HABIT_SAMPLES: Record<string, unknown> = {
	'cue.time': '07:00',
	'cue.range': 'Morning',
	'cue.afterHabitId': H,
	'cue.afterText': 'coffee',
	remind: true
};
const SLOT_SAMPLES: Record<string, unknown> = {
	taskId: T,
	fillRule: { must: { legs: 2 }, mustNot: {}, prefer: [] }
};

type AnyRule = { kind: string; other?: string; others?: string[]; wins?: boolean };
const ruled = (rules: object, kinds: string[]) =>
	(Object.entries(rules) as [string, AnyRule[]][]).flatMap(([path, rule]) =>
		rule.filter((c) => kinds.includes(c.kind)).map((c) => ({ path, c }))
	);

describe('every exclusive pair', () => {
	it('has samples', () => {
		for (const { path, c } of ruled(habitRules, ['exclusive', 'requiresAny'])) {
			expect(HABIT_SAMPLES, path).toHaveProperty([path]);
			if (c.other) expect(HABIT_SAMPLES, c.other).toHaveProperty([c.other]);
		}
		for (const { path, c } of ruled(slotRules, ['exclusive'])) {
			expect(SLOT_SAMPLES, path).toHaveProperty([path]);
			expect(SLOT_SAMPLES, c.other!).toHaveProperty([c.other!]);
		}
	});

	for (const { path, c } of ruled(habitRules, ['exclusive'])) {
		it(`habit: ${path} vs ${c.other} is refused on save, blocked in the editor and fixed in old data`, () => {
			const one = set(base(), c.other!, HABIT_SAMPLES[c.other!]);
			expect(blocked(habitRules, one, path as never, {})?.other).toBe(c.other);
			const both = set(one, path, HABIT_SAMPLES[path]);
			expect(checkHabit(both).errors.length).toBeGreaterThan(0);
			const fixed = checkHabit(both, {}, { resolve: true });
			expect(fixed.errors).toEqual([]);
			expect(fixed.fixed.length).toBe(1);
			// The winner stays.
			const winner = c.wins ? path : c.other!;
			expect(get(fixed.form, winner)).toEqual(HABIT_SAMPLES[winner]);
		});
	}

	for (const { path, c } of ruled(slotRules, ['exclusive'])) {
		it(`slot: ${path} vs ${c.other} is refused on save and fixed in old data`, () => {
			const h = base();
			h.variants[0].slots[0] = { ...h.variants[0].slots[0], [path]: SLOT_SAMPLES[path], [c.other!]: SLOT_SAMPLES[c.other!] };
			expect(checkHabit(h).errors.map((e) => e.path)).toContain('variants.0.slots.0.fillRule');
			const fixed = checkHabit(h, {}, { resolve: true });
			expect(fixed.errors).toEqual([]);
			expect(fixed.form.variants[0].slots[0].taskId).toBe(T);
			expect(fixed.form.variants[0].slots[0].fillRule).toBeNull();
		});
	}
});

describe('habit rules', () => {
	it('a clean habit has no issues', () => {
		const r = checkHabit(base());
		expect([r.errors, r.warnings, r.fixed]).toEqual([[], [], []]);
	});

	it('H3: a reminder with only a part of the day is kept; with neither it is dropped', () => {
		const withRange = { ...base(), remind: true, cue: { ...base().cue, range: 'Morning' } };
		expect(checkHabit(withRange).form.remind).toBe(true);
		expect(checkHabit({ ...base(), remind: true }).form.remind).toBe(false);
		expect(blocked(habitRules, base(), 'remind', {})?.reason).toMatch(/time or a part of the day/);
	});

	it('B1-B3: build-only options are cleared on a break habit and the reverse', () => {
		const b = { ...base(), direction: 'break' as const, levels: { enabled: true, minimum: 'x', target: '', stretch: '' }, quickDone: true };
		const r = checkHabit(b);
		expect(r.form.schedule).toBeNull();
		expect(r.form.variants).toEqual([]);
		expect(r.form.levels.enabled).toBe(false);
		expect(r.form.levels.minimum).toBe('');
		expect(r.form.quickDone).toBe(false);
		expect(r.errors).toEqual([]);
		const built = checkHabit({ ...base(), cost: { amount: 5, unit: '€', perDay: null }, ifThen: { when: 'a', then: 'b', habitId: null } });
		expect(built.form.cost).toBeNull();
		expect(built.form.ifThen).toEqual({ when: '', then: '', habitId: null });
	});

	it('L2, L3: Minimum counts and level targets reset when Levels are off', () => {
		const h = base();
		h.minimumCounts = false;
		h.variants[0].slots[0].minTargets = { [M]: 1 };
		const r = checkHabit(h);
		expect(r.form.minimumCounts).toBe(true);
		expect(r.form.variants[0].slots[0].minTargets).toEqual({});
	});

	it('L4: progression needs a number target', () => {
		const h = { ...base(), progression: { after: 6, by: 5, unit: 'percent' as const } };
		expect(checkHabit(h).errors).toEqual([]);
		h.variants[0].slots[0].targets = {};
		expect(checkHabit(h).errors[0].path).toBe('progression');
	});

	it('L5: a taper floor above the limit is refused', () => {
		const h: HabitForm = {
			...base(),
			direction: 'break',
			limit: { max: 5, period: 'day', taper: { by: 1, every: 'week', floor: 8 }, start: '2026-11-01' }
		};
		expect(checkHabit(h).errors[0].path).toBe('limit');
	});

	it('S3: a weekly rotation needs weekdays', () => {
		const h: HabitForm = {
			...base(),
			schedule: { kind: 'rotation', step: 'week', order: [{ variantId: V, restDays: 1 }], onMiss: 'wait', weekdays: [], start: '2026-11-01' }
		};
		expect(checkHabit(h).errors[0].path).toBe('schedule');
	});

	it('S4, S5: soft conflicts warn but do not block', () => {
		const h = base();
		h.variants.push({ id: H, name: 'B', slots: [] });
		h.streakRule = { kind: 'grace', misses: 3, period: 'week' };
		const r = checkHabit(h);
		expect(r.errors).toEqual([]);
		expect(r.warnings.map((w) => w.path).sort()).toEqual(['schedule', 'streakRule']);
	});

	it('F2: a tag in Must have and Must not have is refused; F3 warns', () => {
		const h = base();
		h.variants[0].slots[0] = { ...h.variants[0].slots[0], taskId: null, fillRule: { must: { legs: 2 }, mustNot: { legs: 0 }, prefer: [] } };
		expect(checkHabit(h).errors.map((e) => e.path)).toEqual(['variants.0.slots.0.fillRule']);
		h.variants[0].slots[0].fillRule = { must: {}, mustNot: { legs: 0 }, prefer: ['legs'] };
		expect(checkHabit(h).warnings.map((e) => e.path)).toEqual(['variants.0.slots.0.fillRule']);
	});

	it('F4: sets are cleared for a Task with nothing per set', () => {
		const h = base();
		h.variants[0].slots[0].sets = 3;
		expect(checkHabit(h, { taskRepeats: () => false }).form.variants[0].slots[0].sets).toBeNull();
		expect(checkHabit(h, { taskRepeats: () => true }).form.variants[0].slots[0].sets).toBe(3);
	});
});

describe('task rules', () => {
	it('M1, M2: options of other Metric types are cleared', () => {
		const t = task();
		t.metrics[0] = { ...t.metrics[0], type: 'text', unit: 'kg', step: 2, choices: ['a'], prefill: 'target' };
		const m = checkTask(t).form.metrics[0];
		expect([m.unit, m.step, m.choices, m.prefill]).toEqual(['', null, [], 'last']);
	});

	it('M5: a tick box always starts unticked', () => {
		const t = task();
		t.metrics[0] = { ...t.metrics[0], type: 'checkbox', prefill: 'last' };
		expect(checkTask(t).form.metrics[0].prefill).toBe('blank');
		t.metrics[0].prefill = 'target';
		expect(checkTask(t).form.metrics[0].prefill).toBe('blank');
		t.metrics[0] = { ...t.metrics[0], type: 'count', prefill: 'last' };
		expect(checkTask(t).form.metrics[0].prefill).toBe('last');
	});

	it('M3: a required field always shows on quick logs', () => {
		const t = task();
		t.metrics[0] = { ...t.metrics[0], required: true, quick: false };
		expect(checkTask(t).form.metrics[0].quick).toBe(true);
		t.metrics[0].required = false;
		expect(checkTask(t).form.metrics[0].quick).toBe(false);
	});

	it('M4: the rest timer needs a field per set', () => {
		const t = task();
		t.metrics[0].repeats = false;
		expect(checkTask(t).form.restTimerEnabled).toBe(false);
	});

	it('a Choice needs two options', () => {
		const t = task();
		t.metrics[0] = { ...t.metrics[0], type: 'choice', choices: ['one'] };
		expect(checkTask(t).errors[0].path).toBe('metrics.0.choices');
	});

	it('metric rules list every exclusive field', () => {
		expect(ruled(metricRules, ['exclusive'])).toEqual([]);
	});
});

describe('settings rules', () => {
	it('G1: overlapping parts of the day, including ones past midnight', () => {
		const r = (name: string, start: string, end: string) => ({ name, start, end });
		expect(overlappingRanges([r('Morning', '05:00', '11:00'), r('Day', '11:00', '17:00')])).toBeNull();
		expect(overlappingRanges([r('Morning', '05:00', '11:00'), r('Late', '10:00', '12:00')])).not.toBeNull();
		expect(overlappingRanges([r('Night', '22:00', '04:00'), r('Early', '03:00', '06:00')])).not.toBeNull();
	});
});
