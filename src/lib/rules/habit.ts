// Conflict rules for the habit editor. Ids (H1, B2...) name each rule.
import { DEFAULT_TRIGGERS, type HabitForm } from '../forms';
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
	type Issue
} from './core';

export type SlotForm = HabitForm['variants'][number]['slots'][number];

export interface HabitCtx {
	/** Does this Task log anything per set? Unknown Tasks are given the benefit of the doubt. */
	taskRepeats?: (taskId: string) => boolean | undefined;
}

const build = (h: HabitForm) => h.direction === 'build';
const brk = (h: HabitForm) => h.direction === 'break';
const BUILD_ONLY = 'Only build habits use this';
const BREAK_ONLY = 'Only break habits use this';

/** Times a habit comes up per week or month, when the Schedule says. */
function timesPer(h: HabitForm, period: 'week' | 'month'): number | null {
	const s = h.schedule;
	if (!s) return null;
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

	// B1: a break habit has no Schedule or Variants.
	variants: [onlyWhen(build, BUILD_ONLY, [])],
	schedule: [
		onlyWhen(build, BUILD_ONLY, null),
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
	remind: [onlyWhen(build, BUILD_ONLY, false), requiresAny(['cue.time', 'cue.range'], 'Set a time or a part of the day first', false)],

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
	'levels.enabled': [onlyWhen(build, BUILD_ONLY, false)],
	'levels.minimum': [onlyWhen((h) => build(h) && h.levels.enabled, 'Turn on Levels first', '')],
	'levels.target': [onlyWhen((h) => build(h) && h.levels.enabled, 'Turn on Levels first', '')],
	'levels.stretch': [onlyWhen((h) => build(h) && h.levels.enabled, 'Turn on Levels first', '')],
	// A day short of its target: counts at the Minimum (any log without Levels), or only in full.
	minimumCounts: [onlyWhen(build, BUILD_ONLY, true)],
	// Days nobody logged: break habits count slips, not days, so only build habits choose.
	unlogged: [onlyWhen(build, BUILD_ONLY, 'missed')],
	quickDone: [onlyWhen(build, BUILD_ONLY, false)],
	// L4: progression raises targets, so it needs some.
	progression: [
		onlyWhen(build, BUILD_ONLY, null),
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
	// F4: sets need something logged per set.
	sets: [
		onlyWhen(
			(s, c) => !s.taskId || c.taskRepeats?.(s.taskId) !== false,
			'Sets need a Task that logs something per set',
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

export { isSet };
