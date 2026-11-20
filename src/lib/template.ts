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
 * Version 3 adds per-Metric log settings, gallery details (meta) and setup questions.
 * Older files still import; the new fields take their defaults.
 */
export const TEMPLATE_VERSION = 3;

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
				choices: z.array(z.string().max(40)).default([]),
				prefill: z.enum(['last', 'target', 'blank']).optional(),
				step: z.number().positive().max(10000).nullable().default(null),
				required: z.boolean().default(false),
				quick: z.boolean().default(true)
			})
		)
		.default([]),
	subtasks: z.array(z.string().min(1).max(120)).default([])
});

const weekdayList = z.array(z.number().int().min(0).max(6)).max(7);

/** Asked when a template is added, so one shared template fits each person. */
export const templateQuestion = z.discriminatedUnion('kind', [
	/** Which weekdays. Fills a weekly Schedule (Variants take turns over the days), a weekly rotation's days, or a frequency's count. */
	z.object({ kind: z.literal('days'), key, label: z.string().min(1).max(200), default: weekdayList }),
	/** A starting number, set as the target of the listed Metrics in every Slot. */
	z.object({
		kind: z.literal('number'),
		key,
		label: z.string().min(1).max(200),
		unit: z.string().max(20).default(''),
		default: z.number(),
		metrics: z.array(key).min(1)
	}),
	/** The cue time. */
	z.object({
		kind: z.literal('time'),
		key,
		label: z.string().min(1).max(200),
		default: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
	})
]);
export type TemplateQuestion = z.infer<typeof templateQuestion>;
export type TemplateAnswers = Record<string, number[] | number | string>;

/** What the gallery shows and filters on. */
export const templateMeta = z.object({
	category: z.string().max(40).default('Other'),
	daysPerWeek: z.number().min(0).max(7).nullable().default(null),
	minutesPerDay: z.number().int().min(0).max(600).nullable().default(null),
	equipment: z.array(z.string().max(40)).default([]),
	/** Suggested Area for the habit and its Tasks, matched by name. */
	area: z.string().max(40).nullable().default(null)
});
export type TemplateMeta = z.infer<typeof templateMeta>;

export const templateFile = z.object({
	format: z.literal(TEMPLATE_FORMAT),
	version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
	name: z.string().min(1).max(120),
	description: z.string().max(2000).default(''),
	meta: templateMeta.nullable().default(null),
	questions: z.array(templateQuestion).max(10).default([]),
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
				after: z.string().max(120).nullable().default(null),
				range: z.string().max(40).nullable().default(null)
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
		meta: null,
		questions: [],
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
								null,
							range: habit.cue.range
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
				choices: m.choices,
				prefill: m.prefill,
				step: m.step,
				required: m.required,
				quick: m.quick
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
			return {
				id,
				name: m.name,
				type: m.type,
				unit: m.unit,
				repeats: m.repeats,
				choices: m.choices,
				prefill: m.prefill ?? (m.type === 'text' ? ('blank' as const) : ('last' as const)),
				step: m.step,
				required: m.required,
				quick: m.quick
			};
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
				subtasks: t.subtasks.map((name) => ({ id: newId(), name })),
				areaId: null,
				collectionIds: []
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
			afterText: tpl.habit.cue?.after ?? null,
			range: tpl.habit.cue?.range ?? null
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
		triggers: tpl.habit.triggers ?? DEFAULT_TRIGGERS,
		areaId: null
	};
	// Rotations and intervals start from the day of import.
	if (habit.schedule && 'start' in habit.schedule) habit.schedule = { ...habit.schedule, start: startDate };
	return { tasks, habit, identities: tpl.habit.identities };
}

/** Fill a template from the answers to its questions. Unanswered questions take their default. */
export function applyAnswers(tpl: TemplateFile, answers: TemplateAnswers): TemplateFile {
	const out: TemplateFile = structuredClone(tpl);
	for (const q of tpl.questions) {
		const a = answers[q.key] ?? q.default;
		if (q.kind === 'days') {
			const days = [...new Set((Array.isArray(a) ? a : q.default).filter((d) => d >= 0 && d <= 6))].sort();
			if (!days.length) continue;
			const s = out.habit.schedule as ScheduleForm | null;
			if (s?.kind === 'weekly') {
				// Keep the Variants' order as the template had it, then deal them out over the chosen days.
				const order = Object.keys(s.days)
					.map(Number)
					.sort()
					.map((d) => s.days[d])
					.filter((v, i, all) => all.indexOf(v) === i);
				const variants = order.length ? order : out.habit.variants.map((v) => v.key);
				out.habit.schedule = {
					...s,
					days: Object.fromEntries(days.map((d, i) => [String(d), variants[i % variants.length]]))
				};
			} else if (s?.kind === 'rotation' && s.step === 'week') {
				out.habit.schedule = { ...s, weekdays: days };
			} else if (s?.kind === 'frequency' && s.period === 'week') {
				out.habit.schedule = { ...s, times: days.length };
			}
		} else if (q.kind === 'number') {
			const n = typeof a === 'number' && Number.isFinite(a) ? a : q.default;
			const tasksWith = new Map(out.tasks.map((t) => [t.key, new Set(t.metrics.map((m) => m.key))]));
			for (const v of out.habit.variants)
				for (const slot of v.slots) {
					const has = slot.task ? tasksWith.get(slot.task) : undefined;
					if (!has) continue;
					for (const m of q.metrics) if (has.has(m)) slot.targets[m] = n;
				}
		} else if (q.kind === 'time') {
			const t = typeof a === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(a) ? a : q.default;
			out.habit.cue = { time: t, place: out.habit.cue?.place ?? null, after: out.habit.cue?.after ?? null, range: out.habit.cue?.range ?? null };
		}
	}
	return out;
}
