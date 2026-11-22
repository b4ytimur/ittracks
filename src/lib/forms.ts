// Shapes the editors send to the server. Shared by the browser (types) and the server (validation).
import { z } from 'zod';
import { metricTypes } from './metric-types';
import { optionForm, type ChoiceOption } from './options';

const id = z.string().uuid();
/** The rule for a name of a habit or Task, shared by the editors and rename in place. */
export const name = z.string().trim().min(1, 'A name is required').max(120, 'Keep names to 120 characters or fewer');

/** Notes are Markdown (src/lib/markdown.ts): room for real instructions or a journal entry. */
export const NOTE_MAX = 20000;

/** How a long text field picks the day's prompt. */
export const PROMPT_ORDERS = { order: 'In order, one a day', random: 'Random each day' } as const;

const goals = z.record(z.string(), z.number()).default({});

/** One part of a Task: a private step, or a Library Task inside it. */
export const partForm = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('step'), id, name }),
	z.object({
		kind: z.literal('task'),
		id,
		taskId: id,
		sets: z.number().int().min(0).max(50).nullable().default(null),
		targets: goals,
		minTargets: goals,
		stretchTargets: goals
	})
]);
export type PartForm = z.infer<typeof partForm>;

export const taskForm = z.object({
	name,
	notes: z.string().max(NOTE_MAX).default(''),
	restTimerEnabled: z.boolean(),
	restTimerSeconds: z.number().int().min(5).max(3600),
	tags: z.array(z.object({ name: z.string().trim().min(1).max(40), level: z.number().int().min(1).max(3) })),
	metrics: z.array(
		z.object({
			id,
			name,
			type: z.enum(metricTypes),
			unit: z.string().trim().max(20).default(''),
			repeats: z.boolean(),
			/** Choice field: its options. Logs store the option's id, so a rename keeps past values. */
			choices: z.array(optionForm).default([]),
			prefill: z.enum(['last', 'target', 'blank']).default('last'),
			step: z.number().positive().max(10000).nullable().default(null),
			required: z.boolean().default(false),
			quick: z.boolean().default(true),
			/** Text field: several lines of Markdown, shown as a note box on the log screen. */
			long: z.boolean().default(false),
			/** Long text field: what a new log starts with, e.g. "## Wins" and "## Lessons". */
			starter: z.string().max(2000).default(''),
			/** Long text field: one prompt shows each day and is saved with the answer. */
			prompts: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
			promptOrder: z.enum(['order', 'random']).default('order'),
			/** Choice field: a number for each option, by its id (Great = 5 ... Bad = 1), so Stats can chart it. */
			scores: z.record(z.string(), z.number().min(-1000).max(1000)).default({})
		})
	),
	/**
	 * What sits inside this Task, in order: private steps (a tick box, hidden from the
	 * Library; the id is the step's own) and Library Tasks with their own sets and targets.
	 * Sets on a Task with parts and no per-set fields are rounds. See engine/parts.ts.
	 */
	parts: z.array(partForm).max(50).default([]),
	areaId: id.nullable().default(null),
	/** Hand-picked Collections this Task is in. */
	collectionIds: z.array(id).default([])
});
export type MetricForm = TaskForm['metrics'][number];
/** Notes and journal options a new Metric starts with: one line, no prompts, no numbers. */
export const noteDefaults = (): Pick<MetricForm, 'long' | 'starter' | 'prompts' | 'promptOrder' | 'scores'> => ({
	long: false,
	starter: '',
	prompts: [],
	promptOrder: 'order',
	scores: {}
});
export type TaskForm = z.infer<typeof taskForm>;

export const fillRule = z.object({
	must: z.record(z.string(), z.number().int().min(1).max(3)).default({}),
	mustNot: z.record(z.string(), z.number().int().min(0).max(2)).default({}),
	prefer: z.array(z.string()).default([])
});

/** How a habit judges its day from the habits inside it: all of them (target null) or `target`. */
const rollupRule = z.object({
	target: z.number().int().min(1).max(100).nullable(),
	minimum: z.number().int().min(1).max(100).nullable()
});
/** A routine's rule, on any schedule of its own (absent: all of them, no Minimum). */
const routine = { rollup: rollupRule.optional() };

const schedule = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('weekly'), days: z.record(z.string(), id), ...routine }),
	z.object({
		kind: z.literal('frequency'),
		times: z.number().int().min(1).max(31),
		period: z.enum(['week', 'month']),
		variantId: id,
		...routine
	}),
	z.object({
		kind: z.literal('interval'),
		every: z.number().int().min(1).max(365),
		start: z.string().date(),
		variantId: id,
		...routine
	}),
	z.object({
		kind: z.literal('rotation'),
		step: z.enum(['variant', 'week']),
		order: z.array(z.object({ variantId: id, restDays: z.number().int().min(0).max(30) })).min(1),
		onMiss: z.enum(['wait', 'skip']),
		weekdays: z.array(z.number().int().min(0).max(6)),
		start: z.string().date(),
		...routine
	}),
	// A group of habits: due when one inside is due; done when all (target null) or `target` are done.
	z.object({ kind: z.literal('group'), ...rollupRule.shape }),
	// Inside a routine: due whenever the routine is (only on its Variants in `on`, when set).
	z.object({ kind: z.literal('follow'), variantId: id, on: z.array(id).max(50).nullable() })
]);
export type ScheduleForm = z.infer<typeof schedule>;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 07:30');
const shortText = z.string().trim().max(120);

export const cueForm = z.object({
	time: time.nullable().default(null),
	place: shortText.nullable().default(null),
	afterHabitId: id.nullable().default(null),
	afterText: shortText.nullable().default(null),
	range: z.string().trim().max(40).nullable().default(null)
});
export type CueForm = z.infer<typeof cueForm>;
export const emptyCue = (): CueForm => ({ time: null, place: null, afterHabitId: null, afterText: null, range: null });

export const streakRuleForm = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('strict') }),
	z.object({ kind: z.literal('neverTwice') }),
	z.object({
		kind: z.literal('grace'),
		misses: z.number().int().min(1).max(15),
		period: z.enum(['week', 'month'])
	}),
	z.object({ kind: z.literal('consistency'), days: z.number().int().min(7).max(365) })
]);

export const levelsForm = z.object({
	enabled: z.boolean(),
	minimum: shortText.default(''),
	target: shortText.default(''),
	stretch: shortText.default('')
});
export type LevelsForm = z.infer<typeof levelsForm>;
export const defaultLevels = (): LevelsForm => ({ enabled: false, minimum: '', target: '', stretch: '' });

export const ifThenForm = z.object({
	when: shortText.default(''),
	then: shortText.default(''),
	habitId: id.nullable().default(null)
});
export type IfThenForm = z.infer<typeof ifThenForm>;

export const bundleForm = z.object({ reward: shortText.default(''), strict: z.boolean().default(false) });
export const rewardForm = z.object({
	celebrate: z.boolean().default(false),
	message: shortText.default(''),
	jar: z
		.object({ amount: z.number().positive().max(1_000_000), unit: z.string().trim().max(20), goal: shortText })
		.nullable()
		.default(null)
});
export const costForm = z.object({
	amount: z.number().positive().max(1_000_000),
	unit: z.string().trim().max(20),
	perDay: z.number().positive().max(10_000).nullable().default(null)
});
export const limitForm = z.object({
	max: z.number().int().min(0).max(1000),
	period: z.enum(['day', 'week']),
	taper: z
		.object({
			by: z.number().int().min(1).max(100),
			every: z.enum(['week', 'month']),
			floor: z.number().int().min(0).max(1000).default(0)
		})
		.nullable()
		.default(null),
	start: z.string().date()
});
export const progressionForm = z.object({
	after: z.number().int().min(2).max(60),
	/** A percentage, or a number of steps: each field's own +/- step, in its own unit. */
	by: z.number().positive().max(1000),
	// 'amount' is the old name for steps, still read from templates and backups.
	unit: z.preprocess((v) => (v === 'amount' ? 'steps' : v), z.enum(['percent', 'steps']))
});
export type RewardForm = z.infer<typeof rewardForm>;

/**
 * The feelings a new break habit offers. Fixed ids: an option id only has to be unique within its
 * habit's list, and a constant keeps the editor's default from changing on every render.
 */
export const DEFAULT_TRIGGERS: readonly ChoiceOption[] = [
	{ id: '8ee13388-f221-491d-a043-21f42abeea8c', name: 'Bored' },
	{ id: '429612bf-4d34-4480-b3a4-b380c57d2bfa', name: 'Stressed' },
	{ id: '25161aa7-0837-4363-b0c3-c13b15d33c65', name: 'Tired' },
	{ id: '883eb337-8935-47d1-84c4-8d21247fb80f', name: 'Social' },
	{ id: 'b1ddacee-965e-4e7b-8001-55fa76a09892', name: 'After a meal' }
];
export const defaultTriggers = (): ChoiceOption[] => DEFAULT_TRIGGERS.map((o) => ({ ...o }));

export const habitForm = z
	.object({
		name,
		direction: z.enum(['build', 'break']),
		notes: z.string().max(NOTE_MAX).default(''),
		startDate: z.string().date(),
		variants: z.array(
			z.object({
				id,
				name,
				slots: z.array(
					z.object({
						id,
						taskId: id.nullable(),
						fillRule: fillRule.nullable(),
						sets: z.number().int().min(0).max(50).nullable(),
						targets: z.record(z.string(), z.number()).default({}),
						minTargets: z.record(z.string(), z.number()).default({}),
						stretchTargets: z.record(z.string(), z.number()).default({})
					})
				)
			})
		),
		schedule: schedule.nullable(),
		cue: cueForm.default(emptyCue),
		streakRule: streakRuleForm.default({ kind: 'neverTwice' }),
		minimumCounts: z.boolean().default(true),
		levels: levelsForm.default(defaultLevels),
		quickDone: z.boolean().default(false),
		remind: z.boolean().default(false),
		identityIds: z.array(id).default([]),
		ifThen: ifThenForm.default({ when: '', then: '', habitId: null }),
		/** Feelings a slip can be logged with. A slip stores the feeling's id, so a rename keeps past slips. */
		triggers: z.array(optionForm).max(20).default(defaultTriggers),
		reframe: shortText.default(''),
		bundle: bundleForm.default({ reward: '', strict: false }),
		prep: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
		reward: rewardForm.default({ celebrate: false, message: '', jar: null }),
		cost: costForm.nullable().default(null),
		limit: limitForm.nullable().default(null),
		progression: progressionForm.nullable().default(null),
		areaId: id.nullable().default(null),
		/** The group or routine this habit sits in, or null. */
		parentId: id.nullable().default(null),
		/** A due day that ends with no log: counted as missed (the default), or ignored. */
		unlogged: z.enum(['missed', 'ignore']).optional()
	})
	.superRefine((h, ctx) => {
		if (h.direction === 'build' && h.variants.length === 0 && h.schedule?.kind !== 'group')
			ctx.addIssue({ code: 'custom', message: 'A build habit needs at least one Variant' });
		if (h.direction === 'build' && !h.schedule)
			ctx.addIssue({ code: 'custom', message: 'A build habit needs a Schedule' });
	});
export type HabitForm = z.infer<typeof habitForm>;

/** First readable message from a failed parse. */
export const firstError = (e: z.ZodError) => e.issues[0]?.message ?? 'Invalid input';
