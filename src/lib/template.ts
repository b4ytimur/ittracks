// Template files: a portable, versioned JSON copy of a Habit and the Tasks it uses, with no Logs.
// Ids inside a template are local keys; importing gives everything fresh ids.
import { z } from 'zod';
import { metricTypes } from './metric-types';
import {
	defaultTriggers,
	defaultLevels,
	bundleForm,
	costForm,
	fillRule,
	levelsForm,
	progressionForm,
	rewardForm,
	streakRuleForm,
	NOTE_MAX,
	type HabitForm,
	type PlainScheduleForm,
	type ScheduleForm,
	type TaskForm
} from './forms';
import { tidyPhases } from './engine/schedule';

export const TEMPLATE_FORMAT = 'ittracks-template';
/**
 * Version 2 adds cues, levels, streak rules, identities and break-habit plans.
 * Version 3 adds per-Metric log settings, gallery details (meta) and setup questions.
 * Version 4 adds a suggested view template.
 * Version 5 adds an Area per Task, a suggested reminder, what unlogged days count as,
 * number questions that keep other numbers in proportion, long text fields (several lines
 * of Markdown, starter text, prompts) and scored choices, and allows 20,000 characters of
 * Markdown in Task and habit notes.
 * Version 6 adds Tasks inside Tasks: a Task's parts, in order, are its steps and other Tasks
 * of the file with their own sets and targets (`subtasks` still lists the steps by name).
 * Version 7 adds phases: a schedule that runs other schedules one after another ("every day
 * with Ramp-up for 1 week, then every day with Maintain"). Phases start on the day of import.
 * Version 8 adds the habits inside a habit (`children`), so a routine or a group travels with
 * everything in it, at any depth. Each names the habit it sits in by key (none: the file's own
 * habit); one that follows its routine keeps following it, by the routine's Variant keys.
 * Version 9 adds which Variant a habit that follows its routine logs on each of the routine's
 * Variants (the follow schedule's `map`, routine Variant key -> the habit's own key).
 * Older files still import; the new fields take their defaults.
 */
export const TEMPLATE_VERSION = 10;

const key = z.string().min(1).max(64);

const templateTask = z.object({
	key,
	name: z.string().min(1).max(120),
	/** Markdown. A shared template's notes come from a stranger: they are only ever shown through src/lib/markdown.ts. */
	notes: z.string().max(NOTE_MAX).default(''),
	restTimerEnabled: z.boolean().default(false),
	restTimerSeconds: z.number().int().min(5).max(3600).default(90),
	// Version 10: its own words, and how a row reads.
	rowOne: z.string().trim().min(1).max(20).default('set'),
	rowMany: z.string().trim().min(1).max(20).default('sets'),
	betweenName: z.string().trim().min(1).max(20).default('Rest'),
	tags: z.array(z.object({ name: z.string().min(1).max(40), level: z.number().int().min(1).max(99) })).default([]),
	/** Version 5: the Task's Area, matched by name on import (falls back to the habit's). */
	area: z.string().max(40).nullable().default(null),
	metrics: z
		.array(
			z.object({
				key,
				name: z.string().min(1).max(120),
				type: z.enum(metricTypes),
				unit: z.string().max(20).default(''),
				repeats: z.boolean().default(false),
				/** Left out before version 10: a Task with several numbers per row keeps its ×. */
				times: z.boolean().optional(),
				better: z.enum(['more', 'less']).nullable().default(null),
				choices: z.array(z.string().max(40)).default([]),
				prefill: z.enum(['last', 'target', 'blank']).optional(),
				step: z.number().positive().max(10000).nullable().default(null),
				required: z.boolean().default(false),
				quick: z.boolean().default(true),
				// Version 5
				long: z.boolean().default(false),
				starter: z.string().max(2000).default(''),
				prompts: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
				promptOrder: z.enum(['order', 'random']).default('order'),
				scores: z.record(z.string(), z.number().min(-1000).max(1000)).default({})
			})
		)
		.default([]),
	/** Steps by name. Read when `parts` is empty (files before version 6). */
	subtasks: z.array(z.string().min(1).max(120)).default([]),
	/** Version 6: what sits inside this Task, in order: a step, or another Task of this file. */
	parts: z
		.array(
			z.union([
				z.object({ step: z.string().min(1).max(120) }),
				z.object({
					task: key,
					sets: z.number().int().min(0).max(50).nullable().default(null),
					targets: z.record(key, z.number()).default({}),
					minTargets: z.record(key, z.number()).default({}),
					stretchTargets: z.record(key, z.number()).default({})
				})
			])
		)
		.max(50)
		.default([])
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
		metrics: z.array(key).min(1),
		/**
		 * Version 5. Off: the answer becomes the target in every Slot with these Metrics.
		 * On: every target moves in proportion to the answer (the default is the reference),
		 * so a lighter day stays lighter. Either way, Minimum and Stretch move with the target.
		 */
		scale: z.boolean().default(false)
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

/** One habit of the file: everything but its logs, with keys instead of ids. */
const templateHabit = z.object({
	name: z.string().min(1).max(120),
	direction: z.enum(['build', 'break']),
	notes: z.string().max(NOTE_MAX).default(''),
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
	/** Version 5: the author had a reminder on. Imports offer to turn it on; it starts off otherwise. */
	remind: z.boolean().default(false),
	/** Version 5: whether a due day left unlogged counts as missed, or is ignored. */
	unlogged: z.enum(['missed', 'ignore']).default('missed'),
	/** Identity statements, matched to the importer's identities by text. */
	identities: z.array(z.string().min(1).max(120)).default([]),
	ifThen: z.object({ when: z.string().max(120), then: z.string().max(120) }).nullable().default(null),
	triggers: z.array(z.string().min(1).max(40)).max(20).nullable().default(null),
	// Added later in version 2; older files simply leave them out.
	reframe: z.string().max(120).default(''),
	bundle: bundleForm.nullable().default(null),
	prep: z.array(z.string().min(1).max(120)).max(20).default([]),
	reward: rewardForm.nullable().default(null),
	cost: costForm.nullable().default(null),
	/** Reduce mode; the taper restarts from the import date. */
	limit: z
		.object({
			max: z.number().int().min(0).max(1000),
			period: z.enum(['day', 'week']),
			taper: z
				.object({
					by: z.number().int().min(1).max(100),
					every: z.enum(['week', 'month']),
					floor: z.number().int().min(0).max(1000).default(0)
				})
				.nullable()
		})
		.nullable()
		.default(null),
	progression: progressionForm.nullable().default(null)
});
export type TemplateHabit = z.infer<typeof templateHabit>;

/** Version 8: a habit inside the file's habit, or inside another one of these (`parent`, by key). */
const templateChild = templateHabit.extend({ key, parent: key.nullable().default(null) });
export type TemplateChild = z.infer<typeof templateChild>;

export const templateFile = z.object({
	format: z.literal(TEMPLATE_FORMAT),
	version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10)]),
	name: z.string().min(1).max(120),
	/** Version 4: a view template this habit works well with (e.g. "gym"). Only ever offered, never applied by itself. */
	view: z.string().max(32).nullable().default(null),
	description: z.string().max(2000).default(''),
	meta: templateMeta.nullable().default(null),
	questions: z.array(templateQuestion).max(10).default([]),
	habit: templateHabit,
	/** Version 8: the habits inside it, parents before the habits inside them. */
	children: z.array(templateChild).max(100).default([]),
	tasks: z.array(templateTask)
});
export type TemplateFile = z.infer<typeof templateFile>;

/**
 * The schedule with every Variant id it names passed through `map` (phases: in each phase).
 * One that follows its routine also names the routine's Variants (`on`, and the keys of `map`):
 * those go through `parentMap`, and stay as they are without one.
 */
export function mapSchedule<S extends ScheduleForm | PlainScheduleForm>(s: S | null, map: (id: string) => string, parentMap?: (id: string) => string): S | null;
export function mapSchedule(s: ScheduleForm | null, map: (id: string) => string, parentMap?: (id: string) => string): ScheduleForm | null {
	if (!s) return null;
	switch (s.kind) {
		case 'phases':
			return { ...s, phases: s.phases.map((p) => ({ ...p, schedule: mapSchedule(p.schedule, map)! })) };
		case 'weekly':
			return { ...s, days: Object.fromEntries(Object.entries(s.days).map(([d, v]) => [d, map(v)])) };
		case 'frequency':
		case 'interval':
			return { ...s, variantId: map(s.variantId) };
		case 'rotation':
			return { ...s, order: s.order.map((o) => ({ ...o, variantId: map(o.variantId) })) };
		case 'group':
			return s;
		case 'follow': {
			const routine = parentMap ?? ((id: string) => id);
			const out = { ...s, variantId: map(s.variantId), on: s.on && parentMap ? s.on.map(parentMap) : s.on };
			if (s.map) out.map = Object.fromEntries(Object.entries(s.map).flatMap(([p, c]) => (c ? [[routine(p), map(c)]] : [])));
			return out;
		}
	}
}

/** Names the template needs for links that can't travel as ids. */
export interface TemplateNames {
	habits?: Map<string, string>;
	identities?: Map<string, string>;
	/** Area names by id, so the habit's and each Task's Area travel by name. */
	areas?: Map<string, string>;
}

/** What the person sharing adds: a description, gallery details and setup questions. */
export interface ShareDetails {
	name?: string;
	description?: string;
	meta?: Partial<TemplateMeta> | null;
	questions?: TemplateQuestion[];
	/** Leave the Areas out (default: carried by name). */
	noArea?: boolean;
	/** Leave out the suggestion to turn the reminder on. */
	noRemind?: boolean;
	/** Send the habit's own note. Left out unless asked for: notes are private. */
	withNote?: boolean;
	/** Leave out the Tasks' How to notes (default: they travel, they explain the Task). */
	noHowTo?: boolean;
}

/** A habit inside the one being shared: its id, the habit it sits in, and its form. */
export interface InsideHabit {
	id: string;
	parentId: string;
	form: HabitForm;
}

/**
 * Build a template from a Habit, the habits inside it (`children`, parents first) and the Tasks
 * their Slots use (keyed by Task id). A child whose parent isn't among the children sits in `habit`.
 */
export function toTemplate(
	habit: HabitForm,
	tasks: Map<string, TaskForm>,
	names: TemplateNames = {},
	share: ShareDetails = {},
	children: InsideHabit[] = []
): TemplateFile {
	const taskKey = new Map([...tasks.keys()].map((id, i) => [id, `t${i + 1}`]));
	const metricKey = new Map<string, string>();
	for (const [id, t] of tasks) {
		t.metrics.forEach((m, j) => metricKey.set(m.id, `${taskKey.get(id)}m${j + 1}`));
	}
	const areaName = (id: string | null) => (id && !share.noArea ? (names.areas?.get(id) ?? null) : null);
	const habitArea = areaName(habit.areaId);
	const meta = share.meta || habitArea ? templateMeta.parse({ ...(share.meta ?? {}), area: habitArea }) : null;
	// Questions name Metrics by id while the form is filled in; the file uses its own keys.
	const questions = (share.questions ?? []).map((q) =>
		q.kind === 'number' ? { ...q, metrics: q.metrics.map((m) => metricKey.get(m) ?? m).filter((m) => [...metricKey.values()].includes(m)) } : q
	);
	// Variant keys are each habit's own (v1, v2…); a follower names its routine's by the routine's keys.
	const variantKeys = (h: HabitForm) => new Map(h.variants.map((v, i) => [v.id, `v${i + 1}`]));
	const rootKeys = variantKeys(habit);
	const childKey = new Map(children.map((c, i) => [c.id, `h${i + 1}`]));
	const childVariantKeys = new Map(children.map((c) => [c.id, variantKeys(c.form)]));

	const habitOf = (h: HabitForm, keys: Map<string, string>, parentKeys: Map<string, string> | undefined): TemplateHabit => ({
		name: h.name,
		direction: h.direction,
		notes: share.withNote ? h.notes : '',
		schedule: mapSchedule(
			h.schedule,
			(id) => keys.get(id) ?? id,
			parentKeys && ((id) => parentKeys.get(id) ?? id)
		),
		variants: h.variants.map((v) => ({
			key: keys.get(v.id)!,
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
			h.cue.time || h.cue.range || h.cue.place || h.cue.afterHabitId || h.cue.afterText
				? {
						time: h.cue.time,
						place: h.cue.place,
						after: (h.cue.afterHabitId && names.habits?.get(h.cue.afterHabitId)) || h.cue.afterText || null,
						range: h.cue.range
					}
				: null,
		streakRule: h.streakRule,
		minimumCounts: h.minimumCounts,
		levels: h.levels.enabled ? h.levels : null,
		quickDone: h.quickDone,
		remind: h.remind && !share.noRemind,
		unlogged: h.unlogged ?? 'missed',
		identities: h.identityIds.map((id) => names.identities?.get(id)).filter((x): x is string => !!x),
		ifThen:
			h.direction === 'break' && (h.ifThen.when || h.ifThen.then || h.ifThen.habitId)
				? { when: h.ifThen.when, then: h.ifThen.then || (h.ifThen.habitId ? (names.habits?.get(h.ifThen.habitId) ?? '') : '') }
				: null,
		// Words only: ids belong to one account's logs.
		triggers: h.direction === 'break' ? h.triggers.map((o) => o.name) : null,
		reframe: h.reframe,
		bundle: h.bundle.reward ? h.bundle : null,
		prep: h.prep,
		reward: h.reward.celebrate || h.reward.message || h.reward.jar ? h.reward : null,
		cost: h.cost,
		limit: h.limit ? { max: h.limit.max, period: h.limit.period, taper: h.limit.taper } : null,
		progression: h.progression
	});

	return {
		format: TEMPLATE_FORMAT,
		version: TEMPLATE_VERSION,
		name: share.name?.trim() || habit.name,
		description: share.description ?? '',
		view: null,
		meta,
		questions,
		habit: habitOf(habit, rootKeys, undefined),
		children: children.map((c) => {
			const parent = childKey.get(c.parentId) ?? null;
			return {
				key: childKey.get(c.id)!,
				parent,
				...habitOf(c.form, childVariantKeys.get(c.id)!, parent ? childVariantKeys.get(c.parentId) : rootKeys)
			};
		}),
		tasks: [...tasks].map(([id, t]) => ({
			key: taskKey.get(id)!,
			name: t.name,
			notes: share.noHowTo ? '' : t.notes,
			restTimerEnabled: t.restTimerEnabled,
			restTimerSeconds: t.restTimerSeconds,
			rowOne: t.rowOne,
			rowMany: t.rowMany,
			betweenName: t.betweenName,
			tags: t.tags,
			area: areaName(t.areaId),
			metrics: t.metrics.map((m) => ({
				key: metricKey.get(m.id)!,
				name: m.name,
				type: m.type,
				unit: m.unit,
				repeats: m.repeats,
				times: m.times,
				better: m.better,
				// Options travel as words, and their numbers by word.
				choices: m.choices.map((o) => o.name),
				prefill: m.prefill,
				step: m.step,
				required: m.required,
				quick: m.quick,
				long: m.long,
				starter: m.starter,
				prompts: m.prompts,
				promptOrder: m.promptOrder,
				scores: Object.fromEntries(m.choices.filter((o) => typeof m.scores[o.id] === 'number').map((o) => [o.name, m.scores[o.id]]))
			})),
			subtasks: t.parts.flatMap((p) => (p.kind === 'step' ? [p.name] : [])),
			parts: t.parts.flatMap((p): TemplateFile['tasks'][number]['parts'] =>
				p.kind === 'step'
					? [{ step: p.name }]
					: taskKey.has(p.taskId)
						? [
								{
									task: taskKey.get(p.taskId)!,
									sets: p.sets,
									targets: rekey(p.targets, metricKey),
									minTargets: rekey(p.minTargets, metricKey),
									stretchTargets: rekey(p.stretchTargets, metricKey)
								}
							]
						: []
			)
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

/** A habit made from a template, with the identity statements to link it to. */
export interface MadeHabit {
	habit: HabitForm;
	identities: string[];
}

/** One of the habits inside, with the key of the habit it sits in (null: the file's own habit). */
export interface MadeChild extends MadeHabit {
	key: string;
	parent: string | null;
}

/**
 * Turn a template into new Tasks and new Habits with fresh ids: the file's habit, and the habits
 * inside it in the file's order (their `parentId` is left for the caller, who saves them).
 * `newId` is injectable for tests; `startDate` is today's date.
 * Identity statements come back separately; the caller links them to real Identities.
 */
export function fromTemplate(
	tpl: TemplateFile,
	startDate: string,
	newId: () => string = () => crypto.randomUUID()
): { tasks: { id: string; form: TaskForm }[]; habit: HabitForm; identities: string[]; children: MadeChild[] } {
	const taskIds = new Map(tpl.tasks.map((t) => [t.key, newId()]));
	const metricIds = new Map<string, string>();
	const tasks = tpl.tasks.map((t) => {
		const rowNumbers = t.metrics.filter((m) => m.repeats && ['number', 'count', 'duration'].includes(m.type));
		const metrics = t.metrics.map((m) => {
			const id = newId();
			metricIds.set(m.key, id);
			const choices = m.choices.map((name) => ({ id: newId(), name }));
			return {
				id,
				name: m.name,
				type: m.type,
				unit: m.unit,
				repeats: m.repeats,
				times: m.times ?? rowNumbers.indexOf(m) > 0,
				better: m.better,
				choices,
				prefill: m.prefill ?? (m.type === 'text' || m.type === 'checkbox' ? ('blank' as const) : ('last' as const)),
				step: m.step,
				required: m.required,
				quick: m.quick,
				long: m.long,
				starter: m.starter,
				prompts: m.prompts,
				promptOrder: m.promptOrder,
				scores: Object.fromEntries(choices.filter((o) => typeof m.scores[o.name] === 'number').map((o) => [o.id, m.scores[o.name]]))
			};
		});
		return {
			id: taskIds.get(t.key)!,
			form: {
				name: t.name,
				notes: t.notes,
				restTimerEnabled: t.restTimerEnabled,
				restTimerSeconds: t.restTimerSeconds,
				rowOne: t.rowOne,
				rowMany: t.rowMany,
				betweenName: t.betweenName,
				tags: t.tags,
				metrics,
				parts: [] as TaskForm['parts'],
				areaId: null,
				collectionIds: []
			}
		};
	});
	// Parts point at other Tasks of the file, so they are filled in once every Task has its id.
	tpl.tasks.forEach((t, i) => {
		const parts: TaskForm['parts'] = t.parts.length
			? t.parts.flatMap((p): TaskForm['parts'] => {
					if ('step' in p) return [{ kind: 'step', id: newId(), name: p.step }];
					const taskId = taskIds.get(p.task);
					if (!taskId) return [];
					return [
						{
							kind: 'task',
							id: newId(),
							taskId,
							sets: p.sets,
							targets: rekey(p.targets, metricIds),
							minTargets: rekey(p.minTargets, metricIds),
							stretchTargets: rekey(p.stretchTargets, metricIds)
						}
					];
				})
			: t.subtasks.map((name) => ({ kind: 'step' as const, id: newId(), name }));
		tasks[i].form.parts = parts;
	});

	/** One habit of the file, with its Variants' new ids by key (a follower maps its routine's through `parentIds`). */
	const habitFrom = (th: TemplateHabit, parentIds: Map<string, string> | undefined) => {
		const variantIds = new Map(th.variants.map((v) => [v.key, newId()]));
		const habit: HabitForm = {
			name: th.name,
			direction: th.direction,
			notes: th.notes,
			startDate,
			variants: th.variants.map((v) => ({
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
			schedule: mapSchedule(
				th.schedule as ScheduleForm | null,
				(k) => variantIds.get(k) ?? k,
				parentIds && ((k) => parentIds.get(k) ?? k)
			),
			cue: {
				time: th.cue?.time ?? null,
				place: th.cue?.place ?? null,
				afterHabitId: null,
				afterText: th.cue?.after ?? null,
				range: th.cue?.range ?? null
			},
			// Version 1 files predate streak rules; they keep the strict rule they were made with.
			streakRule: th.streakRule ?? (tpl.version === 1 ? { kind: 'strict' } : { kind: 'neverTwice' }),
			minimumCounts: th.minimumCounts,
			levels: th.levels ?? defaultLevels(),
			quickDone: th.quickDone,
			// Reminders are a choice for each device, so imports start with them off. The import
			// page offers to turn on one the template suggests (`tpl.habit.remind`).
			remind: false,
			reminder: null,
			unlogged: th.unlogged,
			// Added at the top level; the caller puts the habits inside where they belong.
			parentId: null,
			identityIds: [],
			ifThen: { when: th.ifThen?.when ?? '', then: th.ifThen?.then ?? '', habitId: null },
			triggers: th.triggers ? th.triggers.map((name) => ({ id: newId(), name })) : defaultTriggers(),
			reframe: th.reframe,
			bundle: th.bundle ?? { reward: '', strict: false },
			prep: th.prep,
			reward: th.reward ?? { celebrate: false, message: '', jar: null },
			cost: th.cost,
			limit: th.limit ? { ...th.limit, start: startDate } : null,
			progression: th.progression,
			areaId: null
		};
		// Rotations, intervals and phases start from the day of import.
		if (habit.schedule && 'start' in habit.schedule) habit.schedule = { ...habit.schedule, start: startDate };
		if (habit.schedule?.kind === 'phases') habit.schedule = tidyPhases(habit.schedule);
		return { made: { habit, identities: th.identities }, variantIds };
	};

	const root = habitFrom(tpl.habit, undefined);
	const ids = new Map<string | null, Map<string, string>>([[null, root.variantIds]]);
	const children = tpl.children.map((c) => {
		const one = habitFrom(c, ids.get(c.parent));
		ids.set(c.key, one.variantIds);
		return { key: c.key, parent: c.parent, ...one.made };
	});
	return { tasks, ...root.made, children };
}

/** Round to a step (2.5 kg, 1 rep), without float noise. */
function roundTo(x: number, step: number): number {
	const r = Math.round(x / step) * step;
	return Math.round(r * 1000) / 1000;
}

/**
 * A schedule on the weekdays someone picked: fixed weekdays deal the Variants out over them,
 * in the order the template had; a weekly rotation trains on them; N times a week becomes
 * that many. Other schedules keep their days.
 */
function onDays(s: PlainScheduleForm, days: number[], variantKeys: string[]): PlainScheduleForm {
	if (s.kind === 'weekly') {
		const order = Object.keys(s.days)
			.map(Number)
			.sort()
			.map((d) => s.days[d])
			.filter((v, i, all) => all.indexOf(v) === i);
		const variants = order.length ? order : variantKeys;
		return { ...s, days: Object.fromEntries(days.map((d, i) => [String(d), variants[i % variants.length]])) };
	}
	if (s.kind === 'rotation' && s.step === 'week') return { ...s, weekdays: days };
	if (s.kind === 'frequency' && s.period === 'week') return { ...s, times: days.length };
	return s;
}

/**
 * Fill a template from the answers to its questions. Unanswered questions take their default.
 * Days and time are the file's own habit's (the habits inside that follow it take its days);
 * a number sets its fields wherever they are.
 */
export function applyAnswers(tpl: TemplateFile, answers: TemplateAnswers): TemplateFile {
	const out: TemplateFile = structuredClone(tpl);
	for (const q of tpl.questions) {
		const a = answers[q.key] ?? q.default;
		if (q.kind === 'days') {
			const days = [...new Set((Array.isArray(a) ? a : q.default).filter((d) => d >= 0 && d <= 6))].sort();
			if (!days.length) continue;
			const s = out.habit.schedule as ScheduleForm | null;
			const variantKeys = out.habit.variants.map((v) => v.key);
			// Phases take the days in each phase.
			out.habit.schedule =
				s?.kind === 'phases'
					? { ...s, phases: s.phases.map((p) => ({ ...p, schedule: onDays(p.schedule, days, variantKeys) })) }
					: s && s.kind !== 'group' && s.kind !== 'follow'
						? onDays(s, days, variantKeys)
						: s;
		} else if (q.kind === 'number') {
			const n = typeof a === 'number' && Number.isFinite(a) ? a : q.default;
			const ratio = q.scale && q.default > 0 ? n / q.default : null;
			const metricsOf = new Map(out.tasks.map((t) => [t.key, new Map(t.metrics.map((m) => [m.key, m]))]));
			// Every Slot with these fields, in the habit and in the habits inside it.
			for (const v of [out.habit, ...out.children].flatMap((h) => h.variants))
				for (const slot of v.slots) {
					const has = slot.task ? metricsOf.get(slot.task) : undefined;
					if (!has) continue;
					for (const k of q.metrics) {
						const m = has.get(k);
						if (!m) continue;
						const round = (x: number) => roundTo(x, m.step ?? (m.type === 'count' ? 1 : 0.01));
						const old = slot.targets[k];
						const next = ratio !== null && old !== undefined ? round(old * ratio) : n;
						slot.targets[k] = next;
						// Minimum and Stretch keep their distance from the target.
						const by = old ? next / old : ratio;
						if (by !== null) {
							if (slot.minTargets[k] !== undefined) slot.minTargets[k] = round(slot.minTargets[k] * by);
							if (slot.stretchTargets[k] !== undefined) slot.stretchTargets[k] = round(slot.stretchTargets[k] * by);
						}
					}
				}
		} else if (q.kind === 'time') {
			const t = typeof a === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(a) ? a : q.default;
			// A time and a part of the day can't both be set; the answer is the time.
			out.habit.cue = { time: t, place: out.habit.cue?.place ?? null, after: out.habit.cue?.after ?? null, range: null };
		}
	}
	return out;
}

/** Why a file can't be added, in words, or the template in it. Nothing is added by looking. */
export function checkTemplate(text: string): { ok: true; tpl: TemplateFile } | { ok: false; why: string } {
	if (text.length > 1_000_000) return { ok: false, why: 'That file is too large for a template. A whole backup is restored in Settings.' };
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return { ok: false, why: 'That file can’t be read: it isn’t JSON. Nothing was changed.' };
	}
	const o = (json ?? {}) as { format?: unknown; version?: unknown; tables?: unknown };
	if (o.format !== TEMPLATE_FORMAT) return { ok: false, why: o.tables ? 'That is a whole backup, not a template. It is restored under Settings → Restore from a backup.' : 'That file isn’t an ittracks template. Nothing was changed.' };
	if (typeof o.version === 'number' && o.version > TEMPLATE_VERSION) return { ok: false, why: `That file was made by a newer ittracks (version ${o.version}; this one reads up to ${TEMPLATE_VERSION}). Update this server, then add it.` };
	const p = templateFile.safeParse(json);
	if (p.success) return { ok: true, tpl: p.data };
	const at = p.error.issues[0];
	return { ok: false, why: `That template is broken${at?.path.length ? ` at ${at.path.join(' › ')}` : ''}. Nothing was changed.` };
}
