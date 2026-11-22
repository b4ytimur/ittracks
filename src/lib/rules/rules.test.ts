import { describe, expect, it } from 'vitest';
import { habitForm, taskForm, type HabitForm, type TaskForm } from '../forms';
import { blocked, get, set } from './core';
import { checkHabit, habitRules, slotRules } from './habit';
import { checkTask, metricRules } from './task';
import { checkSettings, cleanSettings, overlappingRanges, settingsRules } from './settings';
import type { Settings } from '../server/settings';
import { fromTemplate } from '../views';

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

const opt = (name: string) => ({ id: crypto.randomUUID(), name });
const task = (): TaskForm =>
	taskForm.parse({
		name: 'Bench',
		restTimerEnabled: true,
		restTimerSeconds: 90,
		tags: [],
		metrics: [{ id: M, name: 'Reps', type: 'count', repeats: true }],
		parts: []
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

	it('L3: level targets reset when Levels are off; "only the full target counts" stays (round 3)', () => {
		const h = base();
		h.minimumCounts = false;
		h.variants[0].slots[0].minTargets = { [M]: 1 };
		const r = checkHabit(h);
		// Without Levels it means a partial day (5 of 6 glasses) doesn't count.
		expect(r.form.minimumCounts).toBe(false);
		expect(r.form.variants[0].slots[0].minTargets).toEqual({});
		// A break habit has no target, so it goes back to the default.
		expect(checkHabit({ ...h, direction: 'break' }).form.minimumCounts).toBe(true);
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

	it('P1-P3: phases after one with no end are refused, weekly rotations need days, unused Variants warn', () => {
		const daily = { kind: 'weekly' as const, days: { '0': V } };
		const h: HabitForm = {
			...base(),
			schedule: { kind: 'phases', start: '2026-11-01', phases: [{ length: null, unit: 'week', schedule: daily }, { length: 1, unit: 'week', schedule: daily }] }
		};
		expect(checkHabit(h).errors.map((e) => e.path)).toEqual(['schedule']);
		h.schedule = {
			kind: 'phases',
			start: '2026-11-01',
			phases: [{ length: 1, unit: 'week', schedule: { kind: 'rotation', step: 'week', order: [{ variantId: V, restDays: 0 }], onMiss: 'wait', weekdays: [], start: '2026-11-01' } }]
		};
		expect(checkHabit(h).errors.map((e) => e.reason)).toEqual(['Pick at least one weekday for each weekly rotation']);
		h.schedule = { kind: 'phases', start: '2026-11-01', phases: [{ length: null, unit: 'week', schedule: daily }] };
		h.variants.push({ id: H, name: 'B', slots: [] });
		const r = checkHabit(h);
		expect(r.errors).toEqual([]);
		expect(r.warnings.map((w) => w.reason)).toEqual(["A Variant isn't in any phase, so it never comes up"]);
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

	it('G1-G4: a group drops what only a habit with its own logs uses; break habits sit in no group', () => {
		const g: HabitForm = {
			...base(),
			schedule: { kind: 'group', target: null, minimum: null },
			quickDone: true,
			remind: true,
			cue: { ...base().cue, time: '07:00' },
			levels: { enabled: true, minimum: 'a', target: 'b', stretch: 'c' },
			progression: { after: 5, by: 5, unit: 'percent' },
			unlogged: 'ignore'
		};
		const r = checkHabit(g);
		expect(r.errors).toEqual([]);
		expect(r.form).toMatchObject({ variants: [], quickDone: false, remind: false, progression: null, unlogged: 'missed' });
		expect(r.form.levels.enabled).toBe(false);
		expect(habitForm.safeParse({ ...g, variants: [] }).success).toBe(true);
		expect(checkHabit({ ...base(), direction: 'break', parentId: H }).form.parentId).toBeNull();
		expect(checkHabit({ ...base(), parentId: H }).form.parentId).toBe(H);
	});

	it('G3: a group Minimum must be fewer habits than its target', () => {
		const g = (target: number | null, minimum: number | null): HabitForm => ({ ...base(), variants: [], schedule: { kind: 'group', target, minimum } });
		expect(checkHabit(g(2, 2)).errors[0]?.reason).toMatch(/fewer habits than the target/);
		expect(checkHabit(g(3, 1)).errors).toEqual([]);
		expect(checkHabit(g(null, 2)).errors).toEqual([]);
	});
});

describe('task rules', () => {
	it('M1, M2: options of other Metric types are cleared', () => {
		const t = task();
		t.metrics[0] = { ...t.metrics[0], type: 'text', unit: 'kg', step: 2, choices: [opt('a')], prefill: 'target' };
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

	it('a Choice needs two options, each with its own name', () => {
		const t = task();
		t.metrics[0] = { ...t.metrics[0], type: 'choice', choices: [opt('one')] };
		expect(checkTask(t).errors[0].path).toBe('metrics.0.choices');
		t.metrics[0].choices = [opt('One'), opt(' one ')];
		expect(checkTask(t).errors[0].reason).toBe('Two options have the same name');
	});

	it('N1: several lines only for Text fields, with starter text and prompts', () => {
		const t = task();
		t.metrics[0] = { ...t.metrics[0], type: 'count', repeats: false, long: true, starter: '## Wins', prompts: ['Why?'], promptOrder: 'random' };
		const m = checkTask(t).form.metrics[0];
		expect([m.long, m.starter, m.prompts, m.promptOrder]).toEqual([false, '', [], 'order']);
		t.metrics[0].type = 'text';
		const kept = checkTask(t).form.metrics[0];
		expect([kept.long, kept.starter, kept.prompts, kept.promptOrder]).toEqual([true, '## Wins', ['Why?'], 'random']);
	});

	it('N3: a long text field never starts with last time\'s text', () => {
		const t = task();
		t.metrics[0] = { ...t.metrics[0], type: 'text', repeats: false, long: true, prefill: 'last' };
		expect(checkTask(t).form.metrics[0].prefill).toBe('blank');
		t.metrics[0].long = false;
		expect(checkTask(t).form.metrics[0].prefill).toBe('last');
	});

	it('N4: a long text field on quick logs warns but saves', () => {
		const t = task();
		t.metrics[0] = { ...t.metrics[0], type: 'text', repeats: false, long: true, quick: true };
		const r = checkTask(t);
		expect(r.errors).toEqual([]);
		expect(r.warnings.map((w) => w.path)).toEqual(['metrics.0.quick']);
		t.metrics[0].quick = false;
		expect(checkTask(t).warnings).toEqual([]);
	});

	it('J4: the prompt order needs prompts', () => {
		const t = task();
		t.metrics[0] = { ...t.metrics[0], type: 'text', repeats: false, long: true, prompts: [], promptOrder: 'random' };
		expect(blocked(metricRules, t.metrics[0], 'promptOrder', undefined)?.reason).toBe('Add prompts first');
		expect(checkTask(t).form.metrics[0].promptOrder).toBe('order');
	});

	it('J5: scored choices have a number on every option or none, and drop numbers of removed options', () => {
		const t = task();
		const [good, bad] = [opt('Good'), opt('Bad')];
		t.metrics[0] = { ...t.metrics[0], type: 'choice', repeats: false, choices: [good, bad], scores: { [good.id]: 5 } };
		expect(checkTask(t).errors.map((e) => e.path)).toEqual(['metrics.0.scores']);
		t.metrics[0].scores = { [good.id]: 5, [bad.id]: 1, gone: 3 };
		const r = checkTask(t);
		expect(r.errors).toEqual([]);
		expect(r.form.metrics[0].scores).toEqual({ [good.id]: 5, [bad.id]: 1 });
		// A renamed option keeps its number: numbers belong to the option, not its name.
		t.metrics[0].choices = [{ ...good, name: 'Great' }, bad];
		expect(checkTask(t).form.metrics[0].scores).toEqual({ [good.id]: 5, [bad.id]: 1 });
		t.metrics[0].scores = {};
		expect(checkTask(t).errors).toEqual([]);
		t.metrics[0] = { ...t.metrics[0], type: 'count', scores: { Good: 5 } };
		expect(checkTask(t).form.metrics[0].scores).toEqual({});
	});

	// Generated: one test per exclusive pair of Metric options.
	const METRIC_SAMPLES: Record<string, Partial<TaskForm['metrics'][number]>> = {
		repeats: { repeats: true },
		long: { type: 'text', long: true }
	};
	it('every exclusive Metric pair has samples', () => {
		for (const { path, c } of ruled(metricRules, ['exclusive'])) {
			expect(METRIC_SAMPLES, path).toHaveProperty([path]);
			expect(METRIC_SAMPLES, c.other!).toHaveProperty([c.other!]);
		}
	});
	for (const { path, c } of ruled(metricRules, ['exclusive'])) {
		it(`metric: ${path} vs ${c.other} is refused on save and blocked in the editor`, () => {
			const plain = { ...task().metrics[0], type: 'text' as const, repeats: false };
			const one = { ...plain, ...METRIC_SAMPLES[c.other!] };
			expect(blocked(metricRules, one, path as never, undefined)?.other).toBe(c.other);
			const both = { ...one, ...METRIC_SAMPLES[path] };
			const t = task();
			t.metrics[0] = both;
			expect(checkTask(t).errors.length).toBeGreaterThan(0);
		});
	}
});

describe('settings rules', () => {
	it('G1: overlapping parts of the day, including ones past midnight', () => {
		const r = (name: string, start: string, end: string) => ({ name, start, end });
		expect(overlappingRanges([r('Morning', '05:00', '11:00'), r('Day', '11:00', '17:00')])).toBeNull();
		expect(overlappingRanges([r('Morning', '05:00', '11:00'), r('Late', '10:00', '12:00')])).not.toBeNull();
		expect(overlappingRanges([r('Night', '22:00', '04:00'), r('Early', '03:00', '06:00')])).not.toBeNull();
	});

	const settings = (patch: Partial<Settings>): Settings => ({
		weightUnit: 'kg',
		ranges: [],
		guidedSetup: true,
		showAllSections: false,
		groupByArea: false,
		pinned: [],
		taskTypes: [],
		pastDays: null,
		nudgeYesterday: true,
		dayNote: false,
		...patch
	});

	it('J3: the day note warns, never clears, while the Journal feature is off', () => {
		const views = { ...fromTemplate('standard'), hidden: ['journal' as const] };
		const off = settings({ dayNote: true, views });
		expect(checkSettings(off).map((i) => [i.path, i.severity])).toEqual([['dayNote', 'warn']]);
		expect(cleanSettings(off).dayNote).toBe(true);
		expect(checkSettings(settings({ dayNote: true }))).toEqual([]);
	});

	it('removing a part of the day a habit uses warns, but never blocks the save', () => {
		const base = settings({ ranges: [{ name: 'Morning', start: '05:00', end: '11:00' }] });
		expect(checkSettings(base, { usedRanges: ['Morning'] })).toEqual([]);
		const issues = checkSettings({ ...base, ranges: [] }, { usedRanges: ['Morning'] });
		expect(issues.map((i) => i.severity)).toEqual(['warn']);
		// Without knowing what habits use (the first-run day question), there is nothing to warn about.
		expect(checkSettings({ ...base, ranges: [] })).toEqual([]);
	});

	it('the yesterday nudge needs past-day logging on, and is cleared when it is off', () => {
		expect(blocked(settingsRules, settings({ pastDays: 0 }), 'nudgeYesterday', { usedRanges: [] })?.reason).toBe(
			'Turn on logging past days first'
		);
		expect(blocked(settingsRules, settings({ pastDays: 7 }), 'nudgeYesterday', { usedRanges: [] })).toBeNull();
		expect(cleanSettings(settings({ pastDays: 0 })).nudgeYesterday).toBe(false);
		expect(cleanSettings(settings({ pastDays: 1 })).nudgeYesterday).toBe(true);
	});

	it('how far back must be a whole number of days, or any time', () => {
		expect(checkSettings(settings({ pastDays: null }))).toEqual([]);
		expect(checkSettings(settings({ pastDays: 30 }))).toEqual([]);
		expect(checkSettings(settings({ pastDays: -1 }))[0]?.path).toBe('pastDays');
		expect(checkSettings(settings({ pastDays: 2.5 }))[0]?.path).toBe('pastDays');
	});
});
