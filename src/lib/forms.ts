// Shapes the editors send to the server. Shared by the browser (types) and the server (validation).
import { z } from 'zod';
import { metricTypes } from './metric-types';

const id = z.string().uuid();
const name = z.string().trim().min(1, 'A name is required').max(120);

export const taskForm = z.object({
	name,
	notes: z.string().max(2000).default(''),
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
			choices: z.array(z.string().trim().min(1).max(40)).default([])
		})
	),
	subtasks: z.array(z.object({ id, name }))
});
export type TaskForm = z.infer<typeof taskForm>;

export const fillRule = z.object({
	must: z.record(z.string(), z.number().int().min(1).max(3)).default({}),
	mustNot: z.record(z.string(), z.number().int().min(0).max(2)).default({}),
	prefer: z.array(z.string()).default([])
});

const schedule = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('weekly'), days: z.record(z.string(), id) }),
	z.object({
		kind: z.literal('frequency'),
		times: z.number().int().min(1).max(31),
		period: z.enum(['week', 'month']),
		variantId: id
	}),
	z.object({
		kind: z.literal('interval'),
		every: z.number().int().min(1).max(365),
		start: z.string().date(),
		variantId: id
	}),
	z.object({
		kind: z.literal('rotation'),
		step: z.enum(['variant', 'week']),
		order: z.array(z.object({ variantId: id, restDays: z.number().int().min(0).max(30) })).min(1),
		onMiss: z.enum(['wait', 'skip']),
		weekdays: z.array(z.number().int().min(0).max(6)),
		start: z.string().date()
	})
]);
export type ScheduleForm = z.infer<typeof schedule>;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 07:30');
const shortText = z.string().trim().max(120);

export const cueForm = z.object({
	time: time.nullable().default(null),
	place: shortText.nullable().default(null),
	afterHabitId: id.nullable().default(null),
	afterText: shortText.nullable().default(null)
});
export type CueForm = z.infer<typeof cueForm>;
export const emptyCue = (): CueForm => ({ time: null, place: null, afterHabitId: null, afterText: null });

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

export const DEFAULT_TRIGGERS = ['Bored', 'Stressed', 'Tired', 'Social', 'After a meal'];

export const habitForm = z
	.object({
		name,
		direction: z.enum(['build', 'break']),
		notes: z.string().max(2000).default(''),
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
		triggers: z.array(z.string().trim().min(1).max(40)).max(20).default(DEFAULT_TRIGGERS)
	})
	.superRefine((h, ctx) => {
		if (h.direction === 'build' && h.variants.length === 0)
			ctx.addIssue({ code: 'custom', message: 'A build habit needs at least one Variant' });
		if (h.direction === 'build' && !h.schedule)
			ctx.addIssue({ code: 'custom', message: 'A build habit needs a Schedule' });
	});
export type HabitForm = z.infer<typeof habitForm>;

/** First readable message from a failed parse. */
export const firstError = (e: z.ZodError) => e.issues[0]?.message ?? 'Invalid input';
