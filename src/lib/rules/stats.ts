// Conflict rules for Stats cards and settings (src/lib/stats/model.ts), rules R1 to R16 in the
// proposal. R1 to R5 are the "honest math" rules: no sums across units that don't match, no
// stacked averages, no running total of an average.
// R13 (page range vs card range) holds by shape: `range` is one field that is either "page"
// or a range. R16 (a measure can't refer to itself) holds by shape too: formulas read fields
// only, never other measures.
import { ADDS_UP, MAX_BOARDS, PER_LOG_FOR, isCustom, type StatCard, type StatsSettings } from '../stats/model';
import { formulaProblem } from '../stats/formula';
import type { StatCtx } from '../stats/catalog';
import { check, defineRules, evaluate, exclusive, independent, onlyWhen, requiresAny, type Issue } from './core';

const NUMERIC = ['number', 'count', 'duration'];
const fieldTypes = (c: StatCtx) => c.fieldTypes;
const src = (f: StatCard) => f.what.source;

/** Splits each source can use. */
const SPLITS_FOR: Record<StatCard['what']['source'], string[]> = {
	outcomes: ['none', 'habit', 'area', 'variant', 'level', 'weekday', 'part'],
	field: ['none', 'habit', 'task', 'tag', 'area', 'variant', 'level', 'weekday', 'part', 'option', 'set', 'field'],
	task: ['none', 'habit', 'task', 'tag', 'area', 'variant', 'level', 'weekday', 'part'],
	slips: ['none', 'habit', 'area', 'weekday', 'part'],
	cravings: ['none', 'habit', 'area', 'weekday', 'part'],
	money: ['none', 'habit', 'area', 'weekday']
};

export const cardRules = defineRules<StatCard, StatCtx>({
	id: independent,
	title: independent,
	'what.source': [
		check((f, c) => (src(f) === 'slips' || src(f) === 'cravings' || src(f) === 'money') && !c.breakHabits, 'Slips, cravings and money saved come from breaking habits, and none are in this card', 'warn'),
		check((f, c) => src(f) === 'money' && c.breakHabits && !c.cost, 'Money saved needs a breaking habit with a cost per day', 'warn')
	],
	'what.metrics': [
		exclusive('what.name', 'Pick fields or a field name to roll up, not both', { wins: true }),
		onlyWhen((f) => src(f) === 'field', 'Only field cards read fields', []),
		check((f) => src(f) === 'field' && !f.what.metrics.length && !f.what.name, 'Pick a field to read')
	],
	'what.name': [
		exclusive('what.metrics', 'Pick fields or a field name to roll up, not both', { fixed: 'kept the picked fields, cleared the roll-up name' }),
		onlyWhen((f) => src(f) === 'field', 'Only field cards roll fields up', null)
	],
	'what.taskId': [onlyWhen((f) => src(f) === 'task', 'Only Task cards pick a Task', null)],
	perLog: [
		// R10 and the measures each source offers
		check((f) => !isCustom(f.perLog) && !PER_LOG_FOR[src(f)].includes(f.perLog as never), "That measure doesn't fit what this card reads"),
		check((f) => isCustom(f.perLog) && src(f) !== 'task', 'Your own measures work on Task cards'),
		// R1
		check((f, c) => src(f) === 'field' && fieldTypes(c).includes('checkbox') && f.perLog !== 'ticked', 'Checkbox fields can be counted, not added up'),
		check((f, c) => src(f) === 'field' && fieldTypes(c).includes('choice') && f.perLog !== 'option' && !(f.perLog === 'score' && c.scored), 'Choice fields can be counted per option, not added up'),
		// J5: scored choices (mood 5 to 1) can be averaged by their numbers.
		check((f, c) => src(f) === 'field' && f.perLog === 'score' && !c.scored, "The option's number needs a Choice field with a number on every option"),
		check((f, c) => src(f) === 'field' && fieldTypes(c).includes('text') && f.perLog !== 'present', 'Text fields can be counted, not added up'),
		check((f, c) => src(f) === 'field' && ['sum', 'best', 'avg', 'sets'].includes(f.perLog) && !c.repeats && fieldTypes(c).every((t) => NUMERIC.includes(t)) && fieldTypes(c).length > 0, 'This field is logged once per log, not per set: use "The value"'),
		// R7
		check((f, c) => src(f) === 'task' && (f.perLog === 'volume' || f.perLog === 'e1rm') && !c.weightReps, 'Volume and e1RM need a Task with a weight field and a reps field, logged per set'),
		check((f, c) => src(f) === 'task' && f.perLog === 'pace' && !c.pace, 'Pace needs a Task with a time field and a distance field'),
		check((f, c) => (f.perLog === 'pctTarget' || (f.perLog === 'targetMet' && src(f) === 'task')) && !c.targets, 'No targets are set for this Task, so there is nothing to compare with', 'warn'),
		check((f, c) => f.perLog === 'targetMet' && src(f) === 'outcomes' && !c.buildHabits, 'Target met only applies to building habits', 'warn'),
		// R15
		check((f, c) => isCustom(f.perLog) && !!c.measureProblem, 'The measure this card uses has a problem: fix it under Your measures')
	],
	overTime: [
		check((f) => (f.perLog === 'option' || f.perLog === 'present') && !ADDS_UP.includes(f.overTime), 'Options and filled-in fields can only be counted')
	],
	bucket: independent,
	split: [
		check((f) => !SPLITS_FOR[src(f)].includes(f.split), "That split doesn't fit what this card reads"),
		check((f, c) => f.split === 'set' && !c.repeats, 'Set number needs a field logged per set'),
		check((f, c) => f.split === 'option' && !fieldTypes(c).includes('choice') && src(f) === 'field', 'Choice option needs a choice field'),
		check((f) => f.split === 'field' && f.what.metrics.length < 2, 'Split by field needs two or more fields'),
		// R11
		check((f, c) => f.split === 'level' && c.hidden.includes('levels'), 'Levels are switched off, so every log counts as Target', 'warn')
	],
	'filter.habits': [check((f, c) => c.archived, 'Shows history only: what this card reads is archived', 'warn')],
	'filter.tags': independent,
	'filter.areas': independent,
	range: independent,
	'compare.previous': independent,
	// R8
	'compare.goal': [exclusive('compare.goalFromTargets', 'Type a goal or take it from the targets, not both', { wins: true })],
	'compare.goalMax': [
		requiresAny(['compare.goal'], 'A goal band needs a bottom value', null),
		check((f) => f.compare.goal !== null && f.compare.goalMax !== null && f.compare.goalMax < f.compare.goal, 'The top of the band is below the bottom')
	],
	'compare.goalFromTargets': [
		exclusive('compare.goal', 'Type a goal or take it from the targets, not both', { fixed: 'kept the typed goal, stopped using targets' }),
		check((f, c) => f.compare.goalFromTargets && !c.targets, 'No targets are set for this field'),
		check((f) => f.compare.goalFromTargets && !(src(f) === 'field' && f.what.metrics.length === 1), 'A goal from targets needs exactly one field of one Task')
	],
	// R5
	'compare.running': [
		onlyWhen((f) => ADDS_UP.includes(f.overTime), 'A running total of an average means nothing', false),
		check((f) => f.compare.running && f.compare.rolling !== 0, "A running total and a rolling average can't be shown together")
	],
	// R6
	'compare.rolling': [
		onlyWhen((f) => ['auto', 'day', 'week', 'session'].includes(f.bucket), 'A rolling average needs a day or week bucket', 0),
		onlyWhen((f) => f.look.chart === 'line' || f.look.chart === 'bars', 'A rolling average is drawn on a line or bars', 0)
	],
	'look.chart': [
		// R3 and R9
		check((f) => (f.look.chart === 'tile' || f.look.chart === 'calendar') && f.split !== 'none', 'A number tile and a calendar show one value: take the split off, or pick bars or a table'),
		check((f) => f.look.chart === 'line' && f.bucket === 'all', 'A line needs a bucket smaller than the whole range'),
		check((f) => f.look.chart === 'calendar' && ['session', 'week', 'month', 'quarter', 'year', 'all'].includes(f.bucket), 'A calendar needs one value per day: set the bucket to Day or Automatic'),
		check((f) => f.look.chart === 'breakdown' && f.split === 'none', 'A breakdown needs something to split by'),
		check((f) => f.look.chart === 'goal' && f.compare.goal === null && !f.compare.goalFromTargets, 'Goal progress needs a goal: type one, or take it from the targets'),
		check((f) => f.look.chart === 'streak' && !['outcomes', 'slips'].includes(src(f)), 'A streak card counts habits: read habit outcomes or slips'),
		check((f) => f.look.chart === 'pattern' && src(f) === 'money', 'Money saved has no time of day, so it has no pattern'),
		check((f) => f.look.chart === 'sessions' && !['field', 'task'].includes(src(f)), 'Recent sessions shows logged Tasks: read a field or a Task'),
		check((f) => f.look.chart === 'sessions' && src(f) === 'task' && !f.what.taskId, 'Recent sessions needs one Task'),
		// R11
		check((f, c) => src(f) === 'money' && c.hidden.includes('cost'), 'Cost and money saved are switched off, so this card is hidden from the other pages', 'warn')
	],
	'look.size': independent,
	// R4
	'look.stacked': [
		check((f) => f.look.stacked && !ADDS_UP.includes(f.overTime), "Stacked averages don't add up to anything: show the series side by side"),
		onlyWhen((f) => f.look.chart === 'bars', 'Only bars can be stacked', false)
	],
	'look.top': independent
});

export const statsSettingsRules = defineRules<StatsSettings>({
	// R14
	boards: [
		check((s) => s.boards.length > MAX_BOARDS, `At most ${MAX_BOARDS} boards`),
		check((s) => new Set(s.boards.map((b) => b.id)).size !== s.boards.length, 'Two boards have the same id')
	],
	open: [check((s) => s.open !== 'last' && !s.boards.some((b) => b.id === s.open), 'Stats can only open with one of your boards')],
	last: independent,
	habitCards: independent,
	headlines: independent,
	// R15
	measures: [
		check((s) => s.measures.some((m) => !!formulaProblem(m.formula)), 'One of your measures has a formula that can\'t be worked out'),
		check((s) => new Set(s.measures.map((m) => m.name.trim().toLowerCase())).size !== s.measures.length, 'Two measures have the same name')
	],
	'muscle.low': independent,
	'muscle.medium': independent,
	'muscle.high': [check((s) => s.muscle.high < s.muscle.medium || s.muscle.medium < s.muscle.low, 'A high tag should count at least as much as a medium one, and medium as much as low', 'warn')],
	e1rm: [
		check((s) => !!formulaProblem(s.e1rm), "The e1RM formula can't be worked out"),
		check((s) => !/\[\s*weight\s*\]/i.test(s.e1rm) || !/\[\s*reps\s*\]/i.test(s.e1rm), 'The e1RM formula needs [Weight] and [Reps]')
	],
	e1rmMaxReps: independent,
	offered: independent
});

export function checkCard(card: StatCard, ctx: StatCtx): Issue[] {
	return evaluate(cardRules, card, ctx);
}

export function checkStatsSettings(s: StatsSettings): Issue[] {
	return evaluate(statsSettingsRules, s, undefined);
}
