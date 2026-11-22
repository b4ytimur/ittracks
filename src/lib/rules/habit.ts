// Conflict rules for the habit editor. Ids (H1, B2...) name each rule.
import { z } from 'zod';
import { DEFAULT_TRIGGERS, type HabitForm } from '../forms';
import { variantsIn, type Schedule } from '../engine/schedule';
import type { FieldEditor } from '../bulk/fields';
import {
	check,
	defineRules,
	evaluate,
	exclusive,
	independent,
	isSet,
	normalize,
	onlyWhen,
	requiresAny,
	type FieldPath,
	type Issue
} from './core';
import { archive, definePolicies, display, locked, pastIssues, recompute, removedItems, unguarded, versioned } from './history';

export type SlotForm = HabitForm['variants'][number]['slots'][number];

export interface HabitCtx {
	/** Does this Task log anything per set? Unknown Tasks are given the benefit of the doubt. */
	taskRepeats?: (taskId: string) => boolean | undefined;
	/** Does this Task have Tasks inside it? Then its sets are rounds. */
	taskHasParts?: (taskId: string) => boolean | undefined;
}

const build = (h: HabitForm) => h.direction === 'build';
const brk = (h: HabitForm) => h.direction === 'break';
/** A group: a build habit whose days come from the habits inside it (G rules). */
const isGroupForm = (h: HabitForm) => h.schedule?.kind === 'group';
const notGroup = (h: HabitForm) => !isGroupForm(h);
const BUILD_ONLY = 'Only build habits use this';
const BREAK_ONLY = 'Only break habits use this';
const NOT_GROUP = "A group's days come from the habits inside it, so it doesn't use this";

/** Times a habit comes up per week or month, when the Schedule says. */
function timesPer(h: HabitForm, period: 'week' | 'month'): number | null {
	const s = h.schedule;
	if (!s) return null;
	if (s.kind === 'group' || s.kind === 'follow' || s.kind === 'phases') return null;
	const perWeek =
		s.kind === 'weekly'
			? Object.keys(s.days).length
			: s.kind === 'frequency'
				? s.period === 'week'
					? s.times
					: s.times / 4.35
				: s.kind === 'interval'
					? 7 / s.every
					: s.step === 'week'
						? s.weekdays.length
						: null;
	if (perWeek === null) return null;
	return period === 'week' ? perWeek : perWeek * 4.35;
}

const hasNumberTarget = (h: HabitForm) => h.variants.some((v) => v.slots.some((s) => Object.keys(s.targets).length > 0));

export const habitRules = defineRules<HabitForm, HabitCtx>({
	name: independent,
	direction: independent,
	notes: independent,
	startDate: independent,
	areaId: independent,
	identityIds: independent,
	reframe: independent,
	// G1: only build habits sit in groups and routines for now (break habits log slips, not days).
	parentId: [onlyWhen(build, BUILD_ONLY, null)],

	// B1: a break habit has no Schedule or Variants. G2: nor does a group; the habits inside it do.
	variants: [onlyWhen(build, BUILD_ONLY, []), onlyWhen(notGroup, 'A group has no Tasks of its own; the habits inside it do', [])],
	schedule: [
		onlyWhen(build, BUILD_ONLY, null),
		// R1: following a routine needs the routine it sits in.
		check((h) => h.schedule?.kind === 'follow' && !h.parentId, 'Pick the routine it sits in, or give it a schedule of its own'),
		// G3: the Minimum is fewer habits than the target.
		check(
			(h) => h.schedule?.kind === 'group' && h.schedule.minimum !== null && h.schedule.target !== null && h.schedule.minimum >= h.schedule.target,
			'The Minimum must be fewer habits than the target'
		),
		// S3: rotation weekdays only apply to a rotation by week, and it needs some.
		check(
			(h) => h.schedule?.kind === 'rotation' && h.schedule.step === 'week' && h.schedule.weekdays.length === 0,
			'Pick at least one weekday for a weekly rotation'
		),
		// S4: these schedules only ever use one Variant.
		check(
			(h) => (h.schedule?.kind === 'frequency' || h.schedule?.kind === 'interval') && h.variants.length > 1,
			'This schedule uses one Variant; the others never come up. Use a rotation to take turns.',
			'warn'
		),
		// P1: phases after one with no end never come.
		check(
			(h) => h.schedule?.kind === 'phases' && h.schedule.phases.slice(0, -1).some((p) => p.length === null),
			'Only the last phase can run on with no end; the phases after it would never come'
		),
		// P2 (S3 inside a phase): a weekly rotation in a phase needs weekdays.
		check(
			(h) => h.schedule?.kind === 'phases' && h.schedule.phases.some((p) => p.schedule.kind === 'rotation' && p.schedule.step === 'week' && p.schedule.weekdays.length === 0),
			'Pick at least one weekday for each weekly rotation'
		),
		// P3 (S4 for phases): a Variant no phase uses never comes up.
		check(
			(h) => {
				if (h.schedule?.kind !== 'phases') return false;
				const used = new Set(variantsIn(h.schedule as Schedule));
				return h.variants.some((v) => !used.has(v.id));
			},
			'A Variant isn\'t in any phase, so it never comes up',
			'warn'
		)
	],

	// H1: a time or a part of the day, not both. Old data keeps the time.
	'cue.time': [
		onlyWhen(build, BUILD_ONLY, null),
		exclusive('cue.range', 'Pick a time or a part of the day, not both', { wins: true })
	],
	'cue.range': [onlyWhen(build, BUILD_ONLY, null), exclusive('cue.time', 'Pick a time or a part of the day, not both', { fixed: 'kept the time, cleared the part of the day' })],
	'cue.place': [onlyWhen(build, BUILD_ONLY, null)],
	// H2: stack after one thing. Old data keeps the habit.
	'cue.afterHabitId': [
		onlyWhen(build, BUILD_ONLY, null),
		exclusive('cue.afterText', 'Stack after a habit or after something else, not both', { wins: true })
	],
	'cue.afterText': [
		onlyWhen(build, BUILD_ONLY, null),
		exclusive('cue.afterHabitId', 'Stack after a habit or after something else, not both', {
			fixed: 'kept the habit it is stacked after, cleared the other cue'
		})
	],
	// H3: a reminder needs a moment to fire.
	remind: [onlyWhen(build, BUILD_ONLY, false), onlyWhen(notGroup, NOT_GROUP, false), requiresAny(['cue.time', 'cue.range'], 'Set a time or a part of the day first', false)],

	// L1 is the streakRule type itself. S5: grace that can never run out.
	streakRule: [
		onlyWhen(build, BUILD_ONLY, { kind: 'neverTwice' }),
		check((h) => {
			if (h.streakRule.kind !== 'grace') return false;
			const n = timesPer(h, h.streakRule.period);
			return n !== null && h.streakRule.misses >= n;
		}, 'With this many grace misses the streak can never break. Lower the misses or use Consistency.', 'warn')
	],
	// L2, L3: Levels.
	// G4: a group's Minimum is a number of habits, set on its schedule.
	'levels.enabled': [onlyWhen(build, BUILD_ONLY, false), onlyWhen(notGroup, NOT_GROUP, false)],
	'levels.minimum': [onlyWhen((h) => build(h) && h.levels.enabled, 'Turn on Levels first', '')],
	'levels.target': [onlyWhen((h) => build(h) && h.levels.enabled, 'Turn on Levels first', '')],
	'levels.stretch': [onlyWhen((h) => build(h) && h.levels.enabled, 'Turn on Levels first', '')],
	// A day short of its target: counts at the Minimum (any log without Levels), or only in full.
	minimumCounts: [onlyWhen(build, BUILD_ONLY, true)],
	// Days nobody logged: break habits count slips, not days, so only build habits choose.
	unlogged: [onlyWhen(build, BUILD_ONLY, 'missed'), onlyWhen(notGroup, NOT_GROUP, 'missed')],
	quickDone: [onlyWhen(build, BUILD_ONLY, false), onlyWhen(notGroup, NOT_GROUP, false)],
	// L4: progression raises targets, so it needs some.
	progression: [
		onlyWhen(build, BUILD_ONLY, null),
		onlyWhen(notGroup, NOT_GROUP, null),
		check((h) => !!h.progression && build(h) && !hasNumberTarget(h), 'Progression needs a number target on at least one Slot')
	],
	'bundle.reward': [onlyWhen(build, BUILD_ONLY, '')],
	'bundle.strict': [onlyWhen((h) => build(h) && !!h.bundle.reward, 'Name what you pair it with first', false)],
	prep: [onlyWhen(build, BUILD_ONLY, [])],
	'reward.celebrate': [onlyWhen(build, BUILD_ONLY, false)],
	'reward.message': [onlyWhen(build, BUILD_ONLY, '')],
	'reward.jar': [onlyWhen(build, BUILD_ONLY, null)],

	// B3: break habits only. B4 (quit vs limit) is the nullable limit itself.
	'ifThen.when': [onlyWhen(brk, BREAK_ONLY, '')],
	'ifThen.then': [onlyWhen(brk, BREAK_ONLY, '')],
	'ifThen.habitId': [onlyWhen(brk, BREAK_ONLY, null)],
	triggers: [onlyWhen(brk, BREAK_ONLY, DEFAULT_TRIGGERS)],
	cost: [onlyWhen(brk, BREAK_ONLY, null)],
	// L5: the taper can't go below its own floor.
	limit: [
		onlyWhen(brk, BREAK_ONLY, null),
		check(
			(h) => !!h.limit?.taper && (h.limit.taper.floor ?? 0) > h.limit.max,
			'The lowest limit must be at or below the starting limit'
		)
	]
});

export interface SlotCtx extends HabitCtx {
	habit: HabitForm;
}

const sameKey = (a: Record<string, number>, b: Record<string, unknown> | string[]) =>
	Object.keys(a).filter((k) => (Array.isArray(b) ? b.includes(k) : k in b));

export const slotRules = defineRules<SlotForm, SlotCtx>({
	id: independent,
	// F1: a Slot is a fixed Task or a Fill rule. Old data keeps the Task.
	taskId: [exclusive('fillRule', 'A Slot uses a fixed Task or a Fill rule, not both', { wins: true })],
	fillRule: [
		exclusive('taskId', 'A Slot uses a fixed Task or a Fill rule, not both', { fixed: 'kept the fixed Task, cleared the Fill rule' }),
		// F2, F3: rules that can never match or never apply.
		check(
			(s) => !!s.fillRule && sameKey(s.fillRule.must, s.fillRule.mustNot).length > 0,
			'A tag can\'t be in both "Must have" and "Must not have"'
		),
		check(
			(s) => !!s.fillRule && s.fillRule.prefer.some((t) => t in s.fillRule!.mustNot),
			'A preferred tag is also in "Must not have", so it never applies',
			'warn'
		)
	],
	// F4: sets need something logged per set, or Tasks inside to repeat in rounds.
	sets: [
		onlyWhen(
			(s, c) => !s.taskId || c.taskRepeats?.(s.taskId) !== false || c.taskHasParts?.(s.taskId) === true,
			'Sets need a Task that logs something per set, or has Tasks inside it to repeat in rounds',
			null
		)
	],
	targets: independent,
	minTargets: [onlyWhen((_s, c) => c.habit.levels.enabled, 'Turn on Levels first', {})],
	stretchTargets: [onlyWhen((_s, c) => c.habit.levels.enabled, 'Turn on Levels first', {})]
});

export interface HabitCheck {
	form: HabitForm;
	/** Problems that stop a save. */
	errors: Issue[];
	/** Probably a mistake, but allowed. */
	warnings: Issue[];
	/** What `resolve` changed in old data, for a one-line note. */
	fixed: string[];
}

/**
 * Clean a habit and check it. Values that can't apply are cleared silently; conflicts
 * are returned. With `resolve`, conflicts in old data are fixed by each rule's winner.
 */
export function checkHabit(input: HabitForm, ctx: HabitCtx = {}, opts: { resolve?: boolean } = {}): HabitCheck {
	const top = normalize(habitRules, input, ctx, opts);
	let form = top.form;
	const fixed = [...top.fixed];
	const issues = evaluate(habitRules, form, ctx);
	form = {
		...form,
		variants: form.variants.map((v, vi) => ({
			...v,
			slots: v.slots.map((s, si) => {
				const sc: SlotCtx = { ...ctx, habit: form };
				const n = normalize(slotRules, s, sc, opts);
				fixed.push(...n.fixed);
				issues.push(...evaluate(slotRules, n.form, sc, `variants.${vi}.slots.${si}.`));
				return n.form;
			})
		}))
	};
	return {
		form,
		errors: issues.filter((i) => i.severity === 'block'),
		warnings: issues.filter((i) => i.severity === 'warn'),
		fixed: [...new Set(fixed)]
	};
}

// ---------- history: what an edit may do to data already logged (rules/history.ts) ----------

const RECOUNT = 'Logs stay as they are; past days are judged again under the new setting';

export const habitPast = definePolicies<HabitForm>({
	name: display(),
	// Build habits log days and break habits log slips: switching would hide one or the other.
	direction: locked('This habit has logs. Build habits keep days and break habits keep slips, so switching would hide them. Make a new habit instead'),
	notes: display(),
	startDate: recompute('Days before a later start stop counting; an earlier start counts the days in between'),
	areaId: display(),
	parentId: recompute("A group's or routine's past days are counted again from the habits inside it now"),
	identityIds: recompute('Identity votes are counted again from the days done'),
	reframe: display(),
	variants: unguarded('Removing a Variant unlinks the days logged with it from it'),
	schedule: versioned('Earlier days keep the schedule they had, unless the change applies to past days too'),
	'cue.time': display(),
	'cue.range': display(),
	'cue.place': display(),
	'cue.afterHabitId': display(),
	'cue.afterText': display(),
	remind: display(),
	streakRule: recompute('Streaks are worked out again from the days logged'),
	'levels.enabled': recompute(RECOUNT),
	'levels.minimum': display(),
	'levels.target': display(),
	'levels.stretch': display(),
	minimumCounts: recompute(RECOUNT),
	unlogged: recompute('Days nobody logged are counted again: as missed, or left out'),
	quickDone: display(),
	progression: display('A raise changes targets from then on; past logs keep the targets they aimed for'),
	'bundle.reward': display(),
	'bundle.strict': display(),
	prep: display(),
	'reward.celebrate': display(),
	'reward.message': display(),
	'reward.jar': recompute('The jar is filled again from the days done, at the new amount'),
	'ifThen.when': display(),
	'ifThen.then': display(),
	'ifThen.habitId': display(),
	triggers: archive('Slips store the feeling, not its word: a renamed feeling is renamed in past slips too, and one removed after a slip used it is archived'),
	cost: unguarded("Money saved uses today's price for every day, so a new price changes past savings"),
	limit: versioned('A changed limit applies from today; past days keep the limit they had')
});

export const slotPast = definePolicies<SlotForm>({
	id: locked('Logs point at a Slot by its id'),
	taskId: versioned('Past logs keep the Task and targets they had'),
	fillRule: versioned('Past days keep the Tasks picked for them'),
	sets: versioned('Past logs keep the sets they aimed for'),
	targets: versioned('Past logs keep the targets they aimed for'),
	minTargets: versioned('Past logs keep the targets they aimed for'),
	stretchTargets: versioned('Past logs keep the targets they aimed for')
});

/** Feelings an edit removes: archived when a slip used them, deleted otherwise. */
export function removedTriggers(
	before: Pick<HabitForm, 'triggers'>,
	after: Pick<HabitForm, 'triggers'>,
	used: ReadonlySet<string> | readonly string[]
): { archive: string[]; drop: string[] } {
	const usedSet = new Set(used);
	return removedItems(habitPast, before as HabitForm, after as HabitForm, (_, id) => usedSet.has(id)).triggers;
}

/** Edits of a habit refused because of what is logged (build or break, once logged). */
export function checkHabitPast(before: HabitForm, after: HabitForm, logged: boolean): Issue[] {
	return pastIssues(habitPast, before, after, logged).map((i) => ({ path: i.path, reason: i.reason, severity: 'block' as const, rule: 'check' as const }));
}

export { isSet };

// ---------- bulk: fields many habits can be set to at once (src/lib/bulk) ----------

/**
 * A field bulk editing can set on many habits at once: its label, its input (one Zod schema for
 * the app, the API and the MCP server) and how the app asks for it. The conflict rules above
 * decide which habits it can't apply to, and its history policy must be `display`, so setting it
 * never touches past days (bulk.test.ts checks both). A new one is one entry here.
 */
export interface BulkField {
	label: string;
	input: z.ZodType;
	editor: FieldEditor;
}

export const habitBulk = {
	areaId: {
		label: 'Area',
		input: z.string().trim().min(1).max(200).nullable().describe('Area id or name; null takes the habits out of their Area.'),
		editor: { kind: 'select', source: 'areas', empty: 'No Area' }
	},
	remind: {
		label: 'Reminders',
		input: z.boolean().describe('Push a reminder at the cue time: true or false.'),
		editor: { kind: 'toggle', on: 'On', off: 'Off' }
	}
} satisfies Partial<Record<FieldPath<HabitForm>, BulkField>>;

export type HabitBulkField = keyof typeof habitBulk;
