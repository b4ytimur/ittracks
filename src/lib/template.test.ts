import { describe, expect, it } from 'vitest';
import { fromTemplate, templateFile, toTemplate } from './template';
import { habitForm, type HabitForm, type TaskForm } from './forms';

const T1 = '00000000-0000-4000-8000-000000000001';
const M1 = '00000000-0000-4000-8000-000000000002';
const M2 = '00000000-0000-4000-8000-000000000003';
const VA = '00000000-0000-4000-8000-000000000004';
const VB = '00000000-0000-4000-8000-000000000005';
const S1 = '00000000-0000-4000-8000-000000000006';
const S2 = '00000000-0000-4000-8000-000000000007';

const bench: TaskForm = {
	name: 'Bench press',
	notes: '',
	restTimerEnabled: true,
	restTimerSeconds: 120,
	tags: [{ name: 'chest', level: 3 }],
	metrics: [
		{ id: M1, name: 'Weight', type: 'number', unit: 'kg', repeats: true, choices: [] },
		{ id: M2, name: 'Reps', type: 'count', unit: '', repeats: true, choices: [] }
	],
	subtasks: [{ id: '00000000-0000-4000-8000-000000000008', name: 'Warm-up set' }]
};

const ID1 = '00000000-0000-4000-8000-000000000009';
const COFFEE = '00000000-0000-4000-8000-000000000010';

const gym: HabitForm = habitForm.parse({
	name: 'Gym',
	direction: 'build',
	notes: '',
	startDate: '2026-11-01',
	variants: [
		{
			id: VA,
			name: 'A',
			slots: [
				{
					id: S1,
					taskId: T1,
					fillRule: null,
					sets: 3,
					targets: { [M2]: 8 },
					minTargets: { [M2]: 1 },
					stretchTargets: { [M2]: 12 }
				}
			]
		},
		{
			id: VB,
			name: 'B',
			slots: [
				{ id: S2, taskId: null, fillRule: { must: { triceps: 3 }, mustNot: {}, prefer: [] }, sets: null, targets: {} }
			]
		}
	],
	schedule: {
		kind: 'rotation',
		step: 'variant',
		onMiss: 'wait',
		weekdays: [],
		start: '2026-11-01',
		order: [
			{ variantId: VA, restDays: 2 },
			{ variantId: VB, restDays: 1 }
		]
	},
	cue: { time: '07:00', place: 'at the gym', afterHabitId: COFFEE, afterText: null },
	levels: { enabled: true, minimum: 'One set', target: 'Full plan', stretch: 'Extra set' },
	streakRule: { kind: 'grace', misses: 1, period: 'week' },
	remind: true,
	identityIds: [ID1],
	reframe: 'I get to train',
	bundle: { reward: 'podcast', strict: true },
	prep: ['Pack the bag'],
	reward: { celebrate: true, message: 'Nice', jar: { amount: 2, unit: '€', goal: 'shoes' } },
	progression: { after: 6, by: 5, unit: 'percent' }
});

describe('templates', () => {
	const tpl = toTemplate(gym, new Map([[T1, bench]]), {
		habits: new Map([[COFFEE, 'Morning coffee']]),
		identities: new Map([[ID1, 'I am an athlete']])
	});

	it('exports a valid file with no ids from the database', () => {
		expect(templateFile.safeParse(JSON.parse(JSON.stringify(tpl))).success).toBe(true);
		const text = JSON.stringify(tpl);
		for (const id of [T1, M1, M2, VA, VB, S1, ID1, COFFEE]) expect(text).not.toContain(id);
	});

	it('carries cues, levels, streak rule and identities as portable values', () => {
		const { habit, identities, tasks } = fromTemplate(tpl, '2026-12-01');
		expect(habit.cue).toEqual({ time: '07:00', place: 'at the gym', afterHabitId: null, afterText: 'Morning coffee' });
		expect(habit.levels.minimum).toBe('One set');
		expect(habit.streakRule).toEqual({ kind: 'grace', misses: 1, period: 'week' });
		expect(habit.remind).toBe(false);
		expect(identities).toEqual(['I am an athlete']);
		expect(habit.reframe).toBe('I get to train');
		expect(habit.bundle).toEqual({ reward: 'podcast', strict: true });
		expect(habit.prep).toEqual(['Pack the bag']);
		expect(habit.reward.jar).toEqual({ amount: 2, unit: '€', goal: 'shoes' });
		expect(habit.progression).toEqual({ after: 6, by: 5, unit: 'percent' });
		const reps = tasks[0].form.metrics.find((m) => m.name === 'Reps')!;
		expect(habit.variants[0].slots[0].minTargets).toEqual({ [reps.id]: 1 });
		expect(habit.variants[0].slots[0].stretchTargets).toEqual({ [reps.id]: 12 });
	});

	it('still imports version 1 files, keeping their strict streak', () => {
		const v1 = JSON.parse(JSON.stringify(tpl));
		v1.version = 1;
		for (const k of ['reframe', 'bundle', 'prep', 'reward', 'cost', 'limit', 'progression', 'cue', 'streakRule', 'levels', 'identities', 'ifThen', 'triggers', 'minimumCounts', 'quickDone'])
			delete v1.habit[k];
		const parsed = templateFile.parse(v1);
		const { habit } = fromTemplate(parsed, '2026-12-01');
		expect(habitForm.safeParse(habit).success).toBe(true);
		expect(habit.streakRule).toEqual({ kind: 'strict' });
		expect(habit.levels.enabled).toBe(false);
	});

	it('round-trips into a valid Habit with fresh ids', () => {
		let n = 100;
		const id = () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`;
		const { tasks, habit } = fromTemplate(tpl, '2026-12-01', id);

		expect(tasks).toHaveLength(1);
		expect(tasks[0].form.name).toBe('Bench press');
		expect(tasks[0].form.subtasks[0].name).toBe('Warm-up set');
		expect(habitForm.safeParse(habit).success).toBe(true);

		// Slots point at the new Task, targets at its new Metric, and the schedule at the new Variants.
		const slotA = habit.variants[0].slots[0];
		expect(slotA.taskId).toBe(tasks[0].id);
		const reps = tasks[0].form.metrics.find((m) => m.name === 'Reps')!;
		expect(slotA.targets).toEqual({ [reps.id]: 8 });
		const s = habit.schedule!;
		expect(s.kind === 'rotation' && s.order.map((o) => o.variantId)).toEqual(habit.variants.map((v) => v.id));
		expect(s.kind === 'rotation' && s.start).toBe('2026-12-01');
		expect(habit.variants[1].slots[0].fillRule).toEqual({ must: { triceps: 3 }, mustNot: {}, prefer: [] });
	});

	it('rejects files that are not templates', () => {
		expect(templateFile.safeParse({ format: 'something-else' }).success).toBe(false);
	});
});
