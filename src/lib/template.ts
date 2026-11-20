// Template files: a portable, versioned JSON copy of a Habit and the Tasks it uses, with no Logs.
// Ids inside a template are local keys; importing gives everything fresh ids.
import { z } from 'zod';
import { metricTypes } from './metric-types';
import {
	DEFAULT_TRIGGERS,
	defaultLevels,
	fillRule,
	levelsForm,
	streakRuleForm,
	type HabitForm,
	type ScheduleForm,
	type TaskForm
} from './forms';

export const TEMPLATE_FORMAT = 'ittracks-template';
/**
 * Version 2 adds cues, levels, streak rules, identities and break-habit plans.
 * Version 1 files still import; the new fields take their defaults.
 */
export const TEMPLATE_VERSION = 2;

const key = z.string().min(1).max(64);

const templateTask = z.object({
	key,
	name: z.string().min(1).max(120),
	notes: z.string().max(2000).default(''),
	restTimerEnabled: z.boolean().default(false),
	restTimerSeconds: z.number().int().min(5).max(3600).default(90),
	tags: z.array(z.object({ name: z.string().min(1).max(40), level: z.number().int().min(1).max(3) })).default([]),
	metrics: z
		.array(
			z.object({
				key,
				name: z.string().min(1).max(120),
				type: z.enum(metricTypes),
				unit: z.string().max(20).default(''),
				repeats: z.boolean().default(false),
				choices: z.array(z.string().max(40)).default([])
			})
		)
		.default([]),
	subtasks: z.array(z.string().min(1).max(120)).default([])
});

export const templateFile = z.object({
	format: z.literal(TEMPLATE_FORMAT),
	version: z.union([z.literal(1), z.literal(2)]),
	name: z.string().min(1).max(120),
	description: z.string().max(2000).default(''),
	habit: z.object({
		name: z.string().min(1).max(120),
		direction: z.enum(['build', 'break']),
		notes: z.string().max(2000).default(''),
		/** Same shape as a saved Schedule, with Variant keys instead of ids. */
		schedule: z.unknown().nullable(),
		variants: z.array(
			z.object({
				key,
				name: z.string().min(1).max(120),
				slots: z.array(
					z.object({
						task: key.nullable(),
						fillRule: fillRule.nullable(),
						sets: z.number().int().min(0).max(50).nullable().default(null),
						/** Metric key -> target value. */
						targets: z.record(z.string(), z.number()).default({}),
						minTargets: z.record(z.string(), z.number()).default({}),
						stretchTargets: z.record(z.string(), z.number()).default({})
					})
				)
			})
		),
		/** Stacking points at a habit outside the template, so it travels as text. */
		cue: z
			.object({
				time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
				place: z.string().max(120).nullable().default(null),
				after: z.string().max(120).nullable().default(null)
			})
			.nullable()
			.default(null),
		streakRule: streakRuleForm.nullable().default(null),
		minimumCounts: z.boolean().default(true),
		levels: levelsForm.nullable().default(null),
		quickDone: z.boolean().default(false),
		/** Identity statements, matched to the importer's identities by text. */
		identities: z.array(z.string().min(1).max(120)).default([]),
		ifThen: z.object({ when: z.string().max(120), then: z.string().max(120) }).nullable().default(null),
		triggers: z.array(z.string().min(1).max(40)).max(20).nullable().default(null)
	}),
	tasks: z.array(templateTask)
});
export type TemplateFile = z.infer<typeof templateFile>;

/** Replace every Variant id inside a Schedule using a mapping. */
function mapSchedule(s: ScheduleForm | null, map: (id: string) => string): ScheduleForm | null {
	if (!s) return null;
	switch (s.kind) {
		case 'weekly':
			return { ...s, days: Object.fromEntries(Object.entries(s.days).map(([d, v]) => [d, map(v)])) };
		case 'frequency':
		case 'interval':
			return { ...s, variantId: map(s.variantId) };
		case 'rotation':
			return { ...s, order: s.order.map((o) => ({ ...o, variantId: map(o.variantId) })) };
	}
}

/** Names the template needs for links that can't travel as ids. */
export interface TemplateNames {
	habits?: Map<string, string>;
	identities?: Map<string, string>;
}

/** Build a template from a Habit and the Tasks its Slots use (keyed by Task id). */
export function toTemplate(
	habit: HabitForm,
	tasks: Map<string, TaskForm>,
	names: TemplateNames = {}
): TemplateFile {
	const variantKey = new Map(habit.variants.map((v, i) => [v.id, `v${i + 1}`]));
	const taskKey = new Map([...tasks.keys()].map((id, i) => [id, `t${i + 1}`]));
	const metricKey = new Map<string, string>();
	for (const [id, t] of tasks) {
		t.metrics.forEach((m, j) => metricKey.set(m.id, `${taskKey.get(id)}m${j + 1}`));
	}
	return {
		format: TEMPLATE_FORMAT,
		version: TEMPLATE_VERSION,
		name: habit.name,
		description: '',
		habit: {
			name: habit.name,
			direction: habit.direction,
			notes: habit.notes,
			schedule: mapSchedule(habit.schedule, (id) => variantKey.get(id) ?? id),
			variants: habit.variants.map((v) => ({
				key: variantKey.get(v.id)!,
				name: v.name,
				slots: v.slots.map((s) => ({
					task: s.taskId ? (taskKey.get(s.taskId) ?? null) : null,
					fillRule: s.fillRule,
					sets: s.sets,
					targets: rekey(s.targets, metricKey),
					minTargets: rekey(s.minTargets, metricKey),
					stretchTargets: rekey(s.stretchTargets, metricKey)
				}))
			})),
			cue:
				habit.cue.time || habit.cue.place || habit.cue.afterHabitId || habit.cue.afterText
					? {
							time: habit.cue.time,
							place: habit.cue.place,
							after:
								(habit.cue.afterHabitId && names.habits?.get(habit.cue.afterHabitId)) ||
								habit.cue.afterText ||
								null
						}
					: null,
			streakRule: habit.streakRule,
			minimumCounts: habit.minimumCounts,
			levels: habit.levels.enabled ? habit.levels : null,
			quickDone: habit.quickDone,
			identities: habit.identityIds
				.map((id) => names.identities?.get(id))
				.filter((x): x is string => !!x),
			ifThen:
				habit.direction === 'break' && (habit.ifThen.when || habit.ifThen.then || habit.ifThen.habitId)
					? {
							when: habit.ifThen.when,
							then:
								habit.ifThen.then ||
								(habit.ifThen.habitId ? (names.habits?.get(habit.ifThen.habitId) ?? '') : '')
						}
					: null,
			triggers: habit.direction === 'break' ? habit.triggers : null
		},
		tasks: [...tasks].map(([id, t]) => ({
			key: taskKey.get(id)!,
			name: t.name,
			notes: t.notes,
			restTimerEnabled: t.restTimerEnabled,
			restTimerSeconds: t.restTimerSeconds,
			tags: t.tags,
			metrics: t.metrics.map((m) => ({
				key: metricKey.get(m.id)!,
				name: m.name,
				type: m.type,
				unit: m.unit,
				repeats: m.repeats,
				choices: m.choices
			})),
			subtasks: t.subtasks.map((s) => s.name)
		}))
	};
}

/** Map a Metric-id keyed record through a key map, dropping unknown Metrics. */
function rekey(r: Record<string, number>, map: Map<string, string>): Record<string, number> {
	return Object.fromEntries(
		Object.entries(r)
			.filter(([m]) => map.has(m))
			.map(([m, v]) => [map.get(m)!, v])
	);
}

/**
 * Turn a template into new Tasks and a new Habit with fresh ids.
 * `newId` is injectable for tests; `startDate` is today's date.
 * Identity statements come back separately; the caller links them to real Identities.
 */
export function fromTemplate(
	tpl: TemplateFile,
	startDate: string,
	newId: () => string = () => crypto.randomUUID()
): { tasks: { id: string; form: TaskForm }[]; habit: HabitForm; identities: string[] } {
	const taskIds = new Map(tpl.tasks.map((t) => [t.key, newId()]));
	const metricIds = new Map<string, string>();
	const tasks = tpl.tasks.map((t) => {
		const metrics = t.metrics.map((m) => {
			const id = newId();
			metricIds.set(m.key, id);
			return { id, name: m.name, type: m.type, unit: m.unit, repeats: m.repeats, choices: m.choices };
		});
		return {
			id: taskIds.get(t.key)!,
			form: {
				name: t.name,
				notes: t.notes,
				restTimerEnabled: t.restTimerEnabled,
				restTimerSeconds: t.restTimerSeconds,
				tags: t.tags,
				metrics,
				subtasks: t.subtasks.map((name) => ({ id: newId(), name }))
			}
		};
	});
	const variantIds = new Map(tpl.habit.variants.map((v) => [v.key, newId()]));
	const habit: HabitForm = {
		name: tpl.habit.name,
		direction: tpl.habit.direction,
		notes: tpl.habit.notes,
		startDate,
		variants: tpl.habit.variants.map((v) => ({
			id: variantIds.get(v.key)!,
			name: v.name,
			slots: v.slots.map((s) => ({
				id: newId(),
				taskId: s.task ? (taskIds.get(s.task) ?? null) : null,
				fillRule: s.fillRule,
				sets: s.sets,
				targets: rekey(s.targets, metricIds),
				minTargets: rekey(s.minTargets, metricIds),
				stretchTargets: rekey(s.stretchTargets, metricIds)
			}))
		})),
		schedule: mapSchedule(tpl.habit.schedule as ScheduleForm | null, (k) => variantIds.get(k) ?? k),
		cue: {
			time: tpl.habit.cue?.time ?? null,
			place: tpl.habit.cue?.place ?? null,
			afterHabitId: null,
			afterText: tpl.habit.cue?.after ?? null
		},
		// Version 1 files predate streak rules; they keep the strict rule they were made with.
		streakRule: tpl.habit.streakRule ?? (tpl.version === 1 ? { kind: 'strict' } : { kind: 'neverTwice' }),
		minimumCounts: tpl.habit.minimumCounts,
		levels: tpl.habit.levels ?? defaultLevels(),
		quickDone: tpl.habit.quickDone,
		// Reminders are a choice for each device, so imports start with them off.
		remind: false,
		identityIds: [],
		ifThen: { when: tpl.habit.ifThen?.when ?? '', then: tpl.habit.ifThen?.then ?? '', habitId: null },
		triggers: tpl.habit.triggers ?? DEFAULT_TRIGGERS
	};
	// Rotations and intervals start from the day of import.
	if (habit.schedule && 'start' in habit.schedule) habit.schedule = { ...habit.schedule, start: startDate };
	return { tasks, habit, identities: tpl.habit.identities };
}
