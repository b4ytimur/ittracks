import { describe, expect, it } from 'vitest';
import { TEMPLATE_VERSION, applyAnswers, fromTemplate, templateFile, toTemplate, type TemplateFile } from './template';
import { habitForm, noteDefaults, type HabitForm, type TaskForm } from './forms';
import { shareDetails, shareForm, type ShareCtx } from './share';
import { checkShare, shareRules } from './rules/share';
import { normalize } from './rules/core';

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
		{ id: M1, name: 'Weight', type: 'number', unit: 'kg', repeats: true, choices: [], prefill: 'last', step: 2.5, required: true, quick: true, ...noteDefaults() },
		{ id: M2, name: 'Reps', type: 'count', unit: '', repeats: true, choices: [], prefill: 'target', step: null, required: false, quick: false, ...noteDefaults() }
	],
	parts: [{ kind: 'step', id: '00000000-0000-4000-8000-000000000008', name: 'Warm-up set' }],
	areaId: null,
	collectionIds: []
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
		expect(habit.cue).toEqual({ time: '07:00', place: 'at the gym', afterHabitId: null, afterText: 'Morning coffee', range: null });
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
		expect(tasks[0].form.parts[0]).toMatchObject({ kind: 'step', name: 'Warm-up set' });
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

	it('carries per-Metric log settings (version 3)', () => {
		const { tasks } = fromTemplate(tpl, '2026-12-01');
		const [w, r] = tasks[0].form.metrics;
		expect(tpl.version).toBe(TEMPLATE_VERSION);
		expect([w.prefill, w.step, w.required, w.quick]).toEqual(['last', 2.5, true, true]);
		expect([r.prefill, r.step, r.required, r.quick]).toEqual(['target', null, false, false]);
	});

	it('carries Tasks inside Tasks with their steps, sets and targets (version 6)', () => {
		const C = '00000000-0000-4000-8000-0000000000c1';
		const circuit: TaskForm = {
			...bench,
			name: 'Circuit',
			restTimerEnabled: false,
			metrics: [],
			parts: [
				{ kind: 'step', id: '00000000-0000-4000-8000-0000000000c2', name: 'Warm up' },
				{ kind: 'task', id: '00000000-0000-4000-8000-0000000000c3', taskId: T1, sets: 2, targets: { [M2]: 10 }, minTargets: {}, stretchTargets: {} }
			]
		};
		const one = { ...gym, variants: [{ ...gym.variants[0], slots: [{ ...gym.variants[0].slots[0], taskId: C, targets: {}, minTargets: {}, stretchTargets: {} }] }], schedule: { kind: 'frequency' as const, times: 7, period: 'week' as const, variantId: VA } };
		const file = templateFile.parse(JSON.parse(JSON.stringify(toTemplate(one, new Map([[C, circuit], [T1, bench]])))));
		expect(file.tasks[0].subtasks).toEqual(['Warm up']);
		const { tasks } = fromTemplate(file, '2026-12-01');
		const back = tasks.find((t) => t.form.name === 'Circuit')!.form;
		const benchBack = tasks.find((t) => t.form.name === 'Bench press')!;
		expect(back.parts[0]).toMatchObject({ kind: 'step', name: 'Warm up' });
		const reps = benchBack.form.metrics.find((m) => m.name === 'Reps')!;
		expect(back.parts[1]).toMatchObject({ kind: 'task', taskId: benchBack.id, sets: 2, targets: { [reps.id]: 10 } });
		// A version 5 file lists steps by name only.
		const v5 = templateFile.parse({ ...file, version: 5, tasks: file.tasks.map((t) => ({ ...t, parts: undefined })) });
		expect(fromTemplate(v5, '2026-12-01').tasks.find((t) => t.form.name === 'Circuit')!.form.parts).toMatchObject([{ kind: 'step', name: 'Warm up' }]);
	});

	it('carries long text fields, prompts and scored choices (version 5)', () => {
		const journal: TaskForm = {
			...bench,
			name: 'Journal',
			notes: '## How\nWrite **anything**.',
			restTimerEnabled: false,
			parts: [],
			metrics: [
				{ ...bench.metrics[0], repeats: false, type: 'text', unit: '', step: null, prefill: 'blank', required: false, long: true, starter: '## Wins\n\n## Lessons', prompts: ['What went well?', 'What did you learn?'], promptOrder: 'random', scores: {} },
				{
					...bench.metrics[1],
					repeats: false,
					type: 'choice',
					choices: [
						{ id: '11111111-1111-4111-8111-111111111111', name: 'Great' },
						{ id: '22222222-2222-4222-8222-222222222222', name: 'Okay' },
						{ id: '33333333-3333-4333-8333-333333333333', name: 'Bad' }
					],
					prefill: 'blank',
					scores: { '11111111-1111-4111-8111-111111111111': 5, '22222222-2222-4222-8222-222222222222': 3, '33333333-3333-4333-8333-333333333333': 1 }
				}
			]
		};
		const one = { ...gym, variants: [{ ...gym.variants[0], slots: [{ ...gym.variants[0].slots[0], targets: {}, minTargets: {}, stretchTargets: {} }] }], schedule: { kind: 'frequency' as const, times: 7, period: 'week' as const, variantId: VA } };
		const file = templateFile.parse(JSON.parse(JSON.stringify(toTemplate(one, new Map([[T1, journal]])))));
		expect(file.version).toBe(TEMPLATE_VERSION);
		const back = fromTemplate(file, '2026-12-01').tasks[0].form;
		expect(back.notes).toBe(journal.notes);
		expect(back.metrics[0]).toMatchObject({ long: true, starter: '## Wins\n\n## Lessons', prompts: ['What went well?', 'What did you learn?'], promptOrder: 'random' });
		// Options travel as words with their numbers, and come back with new ids.
		expect(file.tasks[0].metrics[1]).toMatchObject({ choices: ['Great', 'Okay', 'Bad'], scores: { Great: 5, Okay: 3, Bad: 1 } });
		const opts = back.metrics[1].choices;
		expect(opts.map((o) => o.name)).toEqual(['Great', 'Okay', 'Bad']);
		expect(opts.map((o) => o.id)).not.toContain('11111111-1111-4111-8111-111111111111');
		expect(opts.map((o) => back.metrics[1].scores[o.id])).toEqual([5, 3, 1]);
	});

	it('imports version 4 files with one-line text fields and no numbers', () => {
		const v4 = structuredClone(tpl) as unknown as { version: number; tasks: { metrics: Record<string, unknown>[] }[] };
		v4.version = 4;
		for (const t of v4.tasks) for (const m of t.metrics) { delete m.long; delete m.starter; delete m.prompts; delete m.promptOrder; delete m.scores; }
		const { tasks } = fromTemplate(templateFile.parse(v4), '2026-12-01');
		expect(tasks[0].form.metrics[0]).toMatchObject(noteDefaults());
	});

	it('gives older files sensible log settings', () => {
		const v2 = structuredClone(tpl) as unknown as { version: number; tasks: { metrics: Record<string, unknown>[] }[] };
		v2.version = 2;
		for (const t of v2.tasks) for (const m of t.metrics) { delete m.prefill; delete m.step; delete m.required; delete m.quick; }
		const { tasks } = fromTemplate(templateFile.parse(v2), '2026-12-01');
		expect(tasks[0].form.metrics[0]).toMatchObject({ prefill: 'last', step: null, required: false, quick: true });
	});
});

describe('template questions', () => {
	const base = (schedule: unknown): TemplateFile =>
		templateFile.parse({
			format: 'ittracks-template',
			version: 3,
			name: 'Plan',
			questions: [
				{ kind: 'days', key: 'days', label: 'Which days?', default: [0, 2, 4] },
				{ kind: 'number', key: 'w', label: 'Start weight', default: 20, metrics: ['m1'] },
				{ kind: 'time', key: 't', label: 'When?', default: '07:00' }
			],
			habit: {
				name: 'Plan',
				direction: 'build',
				schedule,
				variants: [
					{ key: 'a', name: 'A', slots: [{ task: 't1', fillRule: null, targets: { m1: 10, m2: 5 } }] },
					{ key: 'b', name: 'B', slots: [{ task: 't1', fillRule: null }] }
				]
			},
			tasks: [
				{
					key: 't1',
					name: 'Squat',
					metrics: [
						{ key: 'm1', name: 'Weight', type: 'number' },
						{ key: 'm2', name: 'Reps', type: 'count' }
					]
				}
			]
		});

	it('deals Variants out over the chosen weekdays', () => {
		const tpl = base({ kind: 'weekly', days: { '0': 'a', '2': 'b', '4': 'a' } });
		const out = applyAnswers(tpl, { days: [1, 3, 5, 6] });
		expect(out.habit.schedule).toEqual({ kind: 'weekly', days: { '1': 'a', '3': 'b', '5': 'a', '6': 'b' } });
	});

	it('uses defaults for unanswered questions', () => {
		const tpl = base({ kind: 'weekly', days: { '0': 'a' } });
		const out = applyAnswers(tpl, {});
		expect(out.habit.schedule).toEqual({ kind: 'weekly', days: { '0': 'a', '2': 'a', '4': 'a' } });
		expect(out.habit.cue?.time).toBe('07:00');
		expect(out.habit.variants[1].slots[0].targets).toEqual({ m1: 20 });
	});

	it('sets a starting number on every Slot with that Metric, and the cue time', () => {
		const out = applyAnswers(base({ kind: 'weekly', days: { '0': 'a' } }), { w: 60, t: '18:30' });
		expect(out.habit.variants[0].slots[0].targets).toEqual({ m1: 60, m2: 5 });
		expect(out.habit.variants[1].slots[0].targets).toEqual({ m1: 60 });
		expect(out.habit.cue?.time).toBe('18:30');
	});

	it('fills a weekly rotation and a weekly frequency from the days', () => {
		const rot = applyAnswers(
			base({ kind: 'rotation', step: 'week', order: [{ variantId: 'a', restDays: 0 }], onMiss: 'wait', weekdays: [0], start: '2026-01-05' }),
			{ days: [1, 4] }
		);
		expect((rot.habit.schedule as { weekdays: number[] }).weekdays).toEqual([1, 4]);
		const freq = applyAnswers(base({ kind: 'frequency', times: 3, period: 'week', variantId: 'a' }), { days: [0, 1] });
		expect((freq.habit.schedule as { times: number }).times).toBe(2);
	});
});

describe('sharing without losing anything (version 5)', () => {
	const AREA = '00000000-0000-4000-8000-000000000020';
	const SKULL = '00000000-0000-4000-8000-000000000021';
	const skull: TaskForm = { ...bench, name: 'Skull crusher', tags: [{ name: 'triceps', level: 3 }], parts: [], areaId: AREA };
	const names = { areas: new Map([[AREA, 'Fitness']]) };

	it('carries the Area of the habit and of each Task by name, and the pool Tasks it is given', () => {
		const tpl = toTemplate({ ...gym, areaId: AREA }, new Map([[T1, bench], [SKULL, skull]]), names);
		expect(tpl.version).toBe(TEMPLATE_VERSION);
		expect(tpl.meta?.area).toBe('Fitness');
		expect(tpl.tasks.map((t) => [t.name, t.area])).toEqual([
			['Bench press', null],
			['Skull crusher', 'Fitness']
		]);
		const { tasks } = fromTemplate(templateFile.parse(JSON.parse(JSON.stringify(tpl))), '2026-12-01');
		expect(tasks.map((t) => t.form.name)).toContain('Skull crusher');
	});

	it('leaves Areas out when asked', () => {
		const tpl = toTemplate({ ...gym, areaId: AREA }, new Map([[SKULL, skull]]), names, { noArea: true });
		expect(tpl.meta).toBeNull();
		expect(tpl.tasks[0].area).toBeNull();
	});

	it('keeps a part of the day when it is the only cue', () => {
		const evening = habitForm.parse({ ...gym, cue: { time: null, place: null, afterHabitId: null, afterText: null, range: 'Evening' } });
		const tpl = toTemplate(evening, new Map([[T1, bench]]));
		expect(tpl.habit.cue).toEqual({ time: null, place: null, after: null, range: 'Evening' });
		expect(fromTemplate(tpl, '2026-12-01').habit.cue.range).toBe('Evening');
	});

	it('suggests the reminder but never turns it on by itself', () => {
		const tpl = toTemplate(gym, new Map([[T1, bench]]));
		expect(tpl.habit.remind).toBe(true);
		expect(fromTemplate(tpl, '2026-12-01').habit.remind).toBe(false);
		expect(toTemplate(gym, new Map([[T1, bench]]), {}, { noRemind: true }).habit.remind).toBe(false);
	});

	it('writes the description, gallery details and questions from the Share form', () => {
		const ctx: ShareCtx = { daysFit: false, days: [], time: '07:00', range: null, area: null, pool: 0, remind: true, note: false, howTo: 0, metricIds: [M2] };
		const form = shareForm.parse({
			name: 'Rosa strength',
			description: 'Three days a week.',
			category: 'Gym',
			askTime: true,
			numbers: [{ label: 'Your reps', metrics: [M2], default: 8 }]
		});
		expect(checkShare(form, ctx).filter((i) => i.severity === 'block')).toEqual([]);
		const tpl = toTemplate(gym, new Map([[T1, bench]]), {}, shareDetails(form, ctx));
		expect(templateFile.safeParse(JSON.parse(JSON.stringify(tpl))).success).toBe(true);
		expect(tpl.name).toBe('Rosa strength');
		expect(tpl.description).toBe('Three days a week.');
		expect(tpl.meta?.category).toBe('Gym');
		expect(tpl.questions.map((q) => q.kind)).toEqual(['time', 'number']);
		const number = tpl.questions[1];
		// The question names the file's own Metric key, not a database id.
		expect(number.kind === 'number' && number.metrics).toEqual([tpl.tasks[0].metrics[1].key]);
		expect(JSON.stringify(tpl)).not.toContain(M2);
	});

	it("keeps the habit's own note out unless the Share form asks for it; How to notes travel unless unticked", () => {
		const private_ = { ...gym, notes: 'Why: my knee surgery' };
		const howTo = { ...bench, notes: 'Keep the elbows tucked.' };
		const ctx: ShareCtx = { daysFit: false, days: [], time: null, range: null, area: null, pool: 0, remind: false, note: true, howTo: 1, metricIds: [] };
		// The plain download and an untouched Share form both leave the note out.
		expect(toTemplate(private_, new Map([[T1, howTo]])).habit.notes).toBe('');
		const plain = toTemplate(private_, new Map([[T1, howTo]]), {}, shareDetails(shareForm.parse({ name: 'x' }), ctx));
		expect(plain.habit.notes).toBe('');
		expect(plain.tasks[0].notes).toBe('Keep the elbows tucked.');
		const both = toTemplate(private_, new Map([[T1, howTo]]), {}, shareDetails(shareForm.parse({ name: 'x', includeNote: true, includeHowTo: false }), ctx));
		expect(both.habit.notes).toBe('Why: my knee surgery');
		expect(both.tasks[0].notes).toBe('');
		// A habit with no note can't ask for one.
		const none = normalize(shareRules, shareForm.parse({ name: 'x', includeNote: true }), { ...ctx, note: false }).form;
		expect(none.includeNote).toBe(false);
	});

	it('share rules: a field set by two questions, or a question with no field, is refused', () => {
		const ctx: ShareCtx = { daysFit: true, days: [0, 2], time: null, range: 'Evening', area: null, pool: 0, remind: false, note: false, howTo: 0, metricIds: [M1, M2] };
		const two = shareForm.parse({ name: 'x', numbers: [{ label: 'a', metrics: [M1], default: 1 }, { label: 'b', metrics: [M1], default: 2 }] });
		expect(checkShare(two, ctx).map((i) => i.reason)).toContain('A field can only be set by one number question');
		const none = shareForm.parse({ name: 'x', numbers: [{ label: 'a', metrics: [], default: 1 }] });
		expect(checkShare(none, ctx).some((i) => i.severity === 'block')).toBe(true);
		const time = shareForm.parse({ name: 'x', askTime: true });
		expect(checkShare(time, ctx).map((i) => i.severity)).toEqual(['warn']);
	});
});

describe('number questions keep Minimum and Stretch in step', () => {
	const tpl = (scale: boolean): TemplateFile =>
		templateFile.parse({
			format: 'ittracks-template',
			version: 5,
			name: 'Squat',
			questions: [{ kind: 'number', key: 'w', label: 'Squat weight', default: 50, metrics: ['m1'], scale }],
			habit: {
				name: 'Squat',
				direction: 'build',
				schedule: null,
				variants: [
					{ key: 'a', name: 'A', slots: [{ task: 't1', fillRule: null, targets: { m1: 50 }, minTargets: { m1: 40 }, stretchTargets: { m1: 60 } }] },
					{ key: 'c', name: 'C', slots: [{ task: 't1', fillRule: null, targets: { m1: 40 } }] }
				]
			},
			tasks: [{ key: 't1', name: 'Squat', metrics: [{ key: 'm1', name: 'Weight', type: 'number', unit: 'kg', step: 2.5 }] }]
		});

	it('sets the target and moves Minimum and Stretch with it', () => {
		const out = applyAnswers(tpl(false), { w: 40 });
		expect(out.habit.variants[0].slots[0]).toMatchObject({ targets: { m1: 40 }, minTargets: { m1: 32.5 }, stretchTargets: { m1: 47.5 } });
		// Without scaling, every Slot gets the answer.
		expect(out.habit.variants[1].slots[0].targets).toEqual({ m1: 40 });
	});

	it('in proportion, a lighter day stays lighter', () => {
		const out = applyAnswers(tpl(true), { w: 100 });
		expect(out.habit.variants[0].slots[0]).toMatchObject({ targets: { m1: 100 }, minTargets: { m1: 80 }, stretchTargets: { m1: 120 } });
		expect(out.habit.variants[1].slots[0].targets).toEqual({ m1: 80 });
	});

	it('a time answer replaces a part of the day', () => {
		const t = templateFile.parse({
			...tpl(false),
			questions: [{ kind: 'time', key: 't', label: 'When?', default: '18:00' }],
			habit: { ...tpl(false).habit, cue: { time: null, place: 'Gym', after: null, range: 'Evening' } }
		});
		expect(applyAnswers(t, { t: '19:00' }).habit.cue).toEqual({ time: '19:00', place: 'Gym', after: null, range: null });
	});
});
