// The one list of actions, version 1. The app's own screens use the same functions underneath,
// and every outside face reads this list: the MCP server turns it into tools, quick-log links
// call log_value and log_done, and scripts post to /api/v1/actions/<name>. Each action has one
// input schema, from which the catalog (and the MCP tool list) is generated.
//
// The contract is internal until the data model settles: names and fields can still change,
// so faces read the catalog instead of hard-coding it, and nothing here is documented as a
// public API yet.
import { z } from 'zod';
import { ActionError, requireScope, type Actor, type Scope } from './actor';
import { addSlip, logDone, logSkip, logTask, logUndo, logValue, removeSlip, resistCraving, writeDayNote, writeLogNote } from './log';
import { describe, getRecord, habitSummary, listLogs, listValues, searchNotes, today } from './read';
import { analysisOptions, correlation, series } from './analysis';
import { statsCompare, statsDescribe, statsGroups, statsTrend } from './statistics';
import { listEvents, EVENT_TYPES } from './events';
import { BUCKETS, OVER_TIME, SOURCES, SPLITS } from '$lib/stats/model';
import { BULK, BULK_NAMES, bulkInput } from '$lib/bulk/catalog';
import { runBulk, undoBulk } from '../bulk';

export const API_VERSION = 1;

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

const habitRef = z.string().trim().min(1).max(200).describe('Habit id, or its name (any case).');
const date = z.string().max(20).optional().describe('YYYY-MM-DD, "today" or "yesterday". Default: today.');
const extra = z.boolean().optional().describe('Log even if the habit is not due that day (an extra session). Default false.');
const range = {
	from: z.string().max(10).optional().describe('First day, YYYY-MM-DD.'),
	to: z.string().max(10).optional().describe('Last day, YYYY-MM-DD. Default: today.'),
	days: z.number().int().min(1).max(3660).optional().describe('Or the last N days ending at `to`.')
};
const paging = {
	limit: z.number().int().min(1).max(5000).optional().describe('Rows per page.'),
	cursor: z.string().max(20).optional().describe('`next` from the previous page.')
};
const habitList = z.array(z.string().max(200)).max(50).optional().describe('Only these habits (ids or names).');
const finish = z.enum(['auto', 'yes', 'no']).optional().describe('auto (default): done once the target is reached or every step is logged.');
const level = z.enum(['minimum', 'target', 'stretch']).optional().describe('The level reached, for habits with levels.');
const fieldValue = z.union([z.number(), z.string().max(20000), z.boolean(), z.null()]);

const seriesSpec = z.object({
	source: z.enum(keys(SOURCES)).optional().describe('What to count. Default outcomes. See analysis_options.'),
	habits: habitList,
	fields: z.array(z.string().max(200)).max(10).optional().describe('source field: field ids (exact) or names (rolls up every field with that name).'),
	task: z.string().max(200).optional().describe('source task: one Task by id or name; left out means every Task.'),
	tags: z.array(z.string().max(100)).max(20).optional().describe('Only Tasks with these tags.'),
	measure: z.string().max(80).optional().describe('How one log becomes a number (perLog), e.g. done, rate, value, sum, best, volume, e1rm, count. See analysis_options.'),
	combine: z.enum(keys(OVER_TIME)).optional().describe('How a bucket combines: sum, avg, median, min, max, last, count, days.'),
	bucket: z.enum(keys(BUCKETS)).optional().describe('day, week, month, quarter, year, session, all, or auto.'),
	split: z.enum(keys(SPLITS)).optional().describe('One series per habit, task, tag, area, variant, level, weekday, part, option, set or field.'),
	range: z.string().max(20).optional().describe('Instead of from/to: week, 7d, month, 30d, 90d, year, 12m, all, since:YYYY-MM-DD.'),
	...range
});

/** One measure, as series takes it but without split or range: what the statistics tools analyse. */
const measureSpec = seriesSpec.omit({ split: true, bucket: true, from: true, to: true, days: true, range: true });
const statBucket = z.enum(['day', 'week', 'month']).optional().describe('One value per day (default), week or month.');
const period = z.object({ from: z.string().max(10), to: z.string().max(10) });

export interface ActionDef<I extends z.ZodTypeAny = z.ZodTypeAny> {
	name: string;
	version: number;
	kind: 'read' | 'write';
	scope: Scope;
	title: string;
	description: string;
	input: I;
	run: (actor: Actor, input: z.infer<I>) => unknown;
}

const def = <I extends z.ZodTypeAny>(d: ActionDef<I>) => d as unknown as ActionDef;

export const ACTIONS: ActionDef[] = [
	// ---------- understand ----------
	def({
		name: 'describe',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Describe the data',
		description:
			'Start here. Lists every habit (schedule, Variants, the Tasks each uses and their targets), every Task with its fields (id, type, unit, per set or once per log, choice options and scores), Areas, custom measures, the date range of the data, and what this key may see. Ids from here make every other call exact.',
		input: z.object({}),
		run: (a) => describe(a)
	}),
	def({
		name: 'analysis_options',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Analysis options',
		description: 'What series and correlate accept: sources, measures per source, ways to combine, buckets, splits and ranges, each with what it means.',
		input: z.object({}),
		run: () => analysisOptions()
	}),
	def({
		name: 'today',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: "Today's plan",
		description: "Today's build habits with status (due, done, skipped) and progress, break habits with days since the last slip, and habits resting today.",
		input: z.object({}),
		run: (a) => today(a)
	}),
	// ---------- query ----------
	def({
		name: 'logs',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Logs by day',
		description:
			'One row per habit and day (status, Variant, level, progress, and a readable summary such as "Bench press: 80 kg × 8, 8, 7"), plus slips and resisted cravings. Newest first. Each row has a ref (log:<id>) to cite or open with record.',
		input: z.object({ ...range, habits: habitList, status: z.array(z.enum(['done', 'missed', 'skipped', 'due', 'slip', 'craving'])).optional(), ...paging }),
		run: (a, i) => listLogs(a, i)
	}),
	def({
		name: 'values',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Every logged value',
		description:
			'The tidy table: one row per value (date, weekday, habit, status, Task, set number, field, type, unit, value, choice score) with a ref (log:<id>) on every row. Filter by habits, Tasks and fields (ids or names). format "csv" returns compact CSV text, best for loading into code. Default range: the last 90 days.',
		input: z.object({
			...range,
			habits: habitList,
			tasks: z.array(z.string().max(200)).max(50).optional().describe('Only these Tasks (ids or names).'),
			fields: z.array(z.string().max(200)).max(50).optional().describe('Only these fields (ids or names).'),
			format: z.enum(['json', 'csv']).optional(),
			...paging
		}),
		run: (a, i) => listValues(a, i)
	}),
	def({
		name: 'record',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Open a ref',
		description: 'Everything about one ref from another answer: log:<id> (every value of that habit-day), slip:<id>, habit:<id>, task:<id> or day:YYYY-MM-DD (all logs that day).',
		input: z.object({ ref: z.string().min(3).max(120) }),
		run: (a, i) => getRecord(a, i)
	}),
	// ---------- analyse ----------
	def({
		name: 'habit_summary',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Habit summary',
		description:
			'Per habit over a range: done, missed, skipped, completion rate (done ÷ (done + missed)), the streak now under its own rule, the longest run, last done, and done/missed by weekday. Break habits: slips, days with slips, clean days, cravings resisted. Default: the last 30 days.',
		input: z.object({ ...range, habits: habitList }),
		run: (a, i) => habitSummary(a, i)
	}),
	def({
		name: 'series',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Time series of a measure',
		description:
			'Any number over time, worked out on the server with the Stats engine: e.g. consistency per week (source outcomes, measure rate, combine avg), water per day (source field, fields ["Water"], combine sum), bench press volume per week (source task, task "Bench press", measure volume), sets per muscle group (source task, measure hardSets, split tag). Returns buckets, one series per split with values, total, summary (n, mean, median, sd, min, max) and trend per bucket. drill: true adds the logs behind the numbers with refs. Call analysis_options for every choice.',
		input: seriesSpec.extend({ drill: z.boolean().optional(), format: z.enum(['json', 'csv']).optional() }),
		run: (a, i) => series(a, i)
	}),
	def({
		name: 'correlate',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Correlate two measures',
		description:
			'How two measures move together per day, week or month: Pearson r with a p-value and 95% CI, Spearman ρ with its p-value, n, and the line fit, with a plain reading. a and b take the same fields as series (without split). lag pairs a with b that many buckets later (e.g. sleep vs next day\'s training: lag 1). Buckets where either side has no data are left out. includePairs returns the paired values.',
		input: z.object({
			a: measureSpec,
			b: measureSpec,
			bucket: z.enum(['day', 'week', 'month']).optional(),
			...range,
			lag: z.number().int().min(-60).max(60).optional(),
			includePairs: z.boolean().optional()
		}),
		run: (a, i) => correlation(a, i)
	}),
	def({
		name: 'stats_describe',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Describe a measure statistically',
		description:
			'Descriptive statistics of one measure per day, week or month: n, mean with a 95% CI, median, sd, quartiles, IQR, MAD, coefficient of variation, skewness, kurtosis, outliers (Tukey) and unusual days (modified z-score > 3.5) with refs, plus lag-1 autocorrelation, a plain reading and caveats. measure takes the same fields as series (without split). Default: the last 90 days, per day.',
		input: z.object({ measure: measureSpec, bucket: statBucket, ...range }),
		run: (a, i) => statsDescribe(a, i)
	}),
	def({
		name: 'stats_trend',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Test for a trend and a shift',
		description:
			"Is a measure going up or down? Least-squares slope per bucket with a 95% CI, p and R²; the Mann-Kendall test (no distribution assumed) with Kendall's τ and Sen's slope; and the most likely single shift in the mean with a permutation p-value (changePoint: false to skip). Gaps count as gaps, not zeros before tracking began. Includes a plain reading and caveats. Default: the last 90 days, per day.",
		input: z.object({ measure: measureSpec, bucket: statBucket, ...range, changePoint: z.boolean().optional() }),
		run: (a, i) => statsTrend(a, i)
	}),
	def({
		name: 'stats_compare',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Compare before and after',
		description:
			"Did a measure change after a date (a new routine, a supplement, a move)? Send at (the first day after) and optionally days (how many days on each side; default as many as have passed since, up to 90), or explicit before and after periods. Returns both sides' descriptives, the difference with a 95% CI (Welch's t-test), Mann-Whitney U, Hedges' g and rank-biserial r with words for their size; for yes/no measures (such as done) the two rates with Fisher's exact test and Cohen's h. Includes a plain reading and caveats; before/after is not an experiment.",
		input: z.object({
			measure: measureSpec,
			bucket: statBucket,
			at: z.string().max(10).optional().describe('First day after the change, YYYY-MM-DD.'),
			days: z.number().int().min(1).max(3660).optional().describe('Days on each side of at.'),
			before: period.optional().describe('Instead of at: the period before, {from, to}.'),
			after: period.optional().describe('Instead of at: the period after, {from, to}.')
		}),
		run: (a, i) => statsCompare(a, i)
	}),
	def({
		name: 'stats_groups',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'Compare weekdays or months',
		description:
			'Does a measure differ by day of the week (by weekday), weekday vs weekend (by weekend) or month (by month)? Per-group n, mean, median and sd; Kruskal-Wallis with ε² and one-way ANOVA with η²; and each group against the rest (Mann-Whitney, Holm-corrected) to show which ones stand out. Includes a plain reading and caveats. Default: the last 90 days (365 for months).',
		input: z.object({ measure: measureSpec, by: z.enum(['weekday', 'weekend', 'month']), ...range }),
		run: (a, i) => statsGroups(a, i)
	}),
	def({
		name: 'search_notes',
		version: 1,
		kind: 'read',
		scope: 'notes',
		title: 'Search notes and journal',
		description: 'Find text in day notes, log notes, journal and other text fields, and slip notes. Each hit has a ref. Leave query empty to list everything written in the range (default: everything). Needs notes access.',
		input: z.object({ query: z.string().max(200).optional(), ...range, ...paging }),
		run: (a, i) => searchNotes(a, i)
	}),
	def({
		name: 'events',
		version: 1,
		kind: 'read',
		scope: 'read',
		title: 'What happened',
		description: `The event log, oldest first after a sequence number: every done, skip, undo, value, slip and note saved, by the app, a key, a link or an assistant (notes text is never in it). Types: ${Object.keys(EVENT_TYPES).join(', ')}.`,
		input: z.object({ after: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(500).optional(), types: z.array(z.string().max(40)).max(20).optional() }),
		run: (a, i) => ({ events: listEvents(a, i) })
	}),
	// ---------- log ----------
	def({
		name: 'log_done',
		version: 1,
		kind: 'write',
		scope: 'log',
		title: 'Mark a habit done',
		description:
			'Mark a build habit done for a day. how: auto (default: copies the last log when the habit has Tasks, else a plain done), targets (logs the targets at a level), same (copies the last log), mark (keeps what is logged). If a required field is empty the log stays due and `missing` lists what to fill in.',
		input: z.object({ habit: habitRef, date, how: z.enum(['auto', 'targets', 'same', 'mark']).optional(), level, variant: z.string().max(200).optional(), extra }),
		run: (a, i) => logDone(a, i)
	}),
	def({
		name: 'log_value',
		version: 1,
		kind: 'write',
		scope: 'log',
		title: 'Log a value',
		description:
			'Log one once-per-log value, e.g. 250 ml of water, 20 minutes of Spanish, a mood. Numbers add to what is already logged that day unless mode is "set". With no field, it uses the habit\'s one number with a target (or its only number). Finishes the habit when the target is reached (finish: auto).',
		input: z.object({
			habit: habitRef,
			date,
			value: z.union([z.number(), z.string().max(20000), z.boolean()]),
			field: z.string().max(200).optional().describe('Field id or name; see describe.'),
			task: z.string().max(200).optional().describe('Task id or name, when the habit has several.'),
			mode: z.enum(['add', 'set']).optional(),
			finish,
			extra
		}),
		run: (a, i) => logValue(a, i)
	}),
	def({
		name: 'log_task',
		version: 1,
		kind: 'write',
		scope: 'log',
		title: "Log a Task's sets",
		description:
			'Log one Task of a habit\'s day: sets (e.g. [{"Weight": 80, "Reps": 8}, {"Weight": 80, "Reps": 8}]), once-per-log values, and ticks for the steps inside it. Field keys are ids or names. A Task inside another Task is named by its path, e.g. "Circuit › Push-ups"; when the Circuit repeats in rounds, round picks one (default: the first round with nothing logged for it yet). Replaces what was logged at that place unless replace is false (then the sets are added). Finishes the habit when every step is logged (finish: auto).',
		input: z.object({
			habit: habitRef,
			date,
			task: z.string().min(1).max(400).describe('The Task by name, id, or path inside another Task ("Circuit › Push-ups").'),
			round: z.number().int().min(1).max(50).optional().describe('For a Task inside a Circuit that repeats: which round, from 1.'),
			sets: z.array(z.record(z.string(), fieldValue)).max(100).optional(),
			values: z.record(z.string(), fieldValue).optional(),
			ticks: z.array(z.string().max(200)).max(50).optional().describe('Steps inside the Task to tick, by id or name.'),
			replace: z.boolean().optional(),
			finish,
			extra
		}),
		run: (a, i) => logTask(a, i)
	}),
	def({
		name: 'log_skip',
		version: 1,
		kind: 'write',
		scope: 'log',
		title: 'Skip a habit',
		description: 'Skip a build habit for a day. A skip neither adds to nor breaks a streak.',
		input: z.object({ habit: habitRef, date, extra }),
		run: (a, i) => logSkip(a, i)
	}),
	def({
		name: 'log_undo',
		version: 1,
		kind: 'write',
		scope: 'log',
		title: 'Undo done or skipped',
		description: 'Put a done or skipped day back to due. clear: true also removes what was logged (on a past day it takes the log away, as the Day page does).',
		input: z.object({ habit: habitRef, date, clear: z.boolean().optional() }),
		run: (a, i) => logUndo(a, i)
	}),
	def({
		name: 'log_slip',
		version: 1,
		kind: 'write',
		scope: 'log',
		title: 'Log a slip',
		description: 'Log a slip of a break habit (it resets the run). Optional count, time (HH:MM), place, feeling, with whom; notes need notes access.',
		input: z.object({
			habit: habitRef,
			date,
			count: z.number().int().min(1).max(1000).optional(),
			time: z.string().max(5).optional(),
			place: z.string().max(120).optional(),
			feeling: z.string().max(40).optional().describe("One of the habit's feelings (describe lists them), by name or id."),
			withWhom: z.string().max(120).optional(),
			notes: z.string().max(20000).optional()
		}),
		run: (a, i) => addSlip(a, i)
	}),
	def({
		name: 'remove_slip',
		version: 1,
		kind: 'write',
		scope: 'log',
		title: 'Take back a slip',
		description: 'Remove a slip by its id (from log_slip or a slip:<id> ref).',
		input: z.object({ slip: z.string().min(1).max(80).describe('Slip id, or slip:<id>.') }),
		run: (a, i) => {
			const r = removeSlip(a, i.slip.replace(/^slip:/, ''));
			return { removed: `slip:${r.id}`, habitId: r.habitId, date: r.date };
		}
	}),
	def({
		name: 'log_craving',
		version: 1,
		kind: 'write',
		scope: 'log',
		title: 'Log a resisted craving',
		description: 'Record a craving resisted on a break habit.',
		input: z.object({ habit: habitRef, date, time: z.string().max(5).optional() }),
		run: (a, i) => resistCraving(a, i)
	}),
	def({
		name: 'write_day_note',
		version: 1,
		kind: 'write',
		scope: 'notes',
		title: 'Write the day note',
		description: "Save the day's free Markdown note (Settings → Journal). append: true adds to it instead of replacing. Needs notes access.",
		input: z.object({ date, text: z.string().max(20000), append: z.boolean().optional() }),
		run: (a, i) => writeDayNote(a, i)
	}),
	// ---------- change many at once ----------
	def({
		name: 'bulk',
		version: 1,
		kind: 'write',
		scope: 'log',
		title: 'Change many at once',
		description: `One change on many habits or Tasks: ${BULK_NAMES.map((n) => `${n} (${BULK[n].title}, on ${BULK[n].target}s${BULK[n].scope === 'edit' ? ', needs edit access' : ''}): ${BULK[n].description}`).join(' ')} Pick the items with ids (or names), or every item that matches a filter ({} is all). Without apply it only previews: what would change, and what would be left as it is and why. With apply: true it changes everything in one go and returns a batch id; bulk_undo with it puts everything back.`,
		input: bulkInput,
		run: (a, i) => runBulk(a, i)
	}),
	def({
		name: 'bulk_undo',
		version: 1,
		kind: 'write',
		scope: 'log',
		title: 'Undo a bulk change',
		description: 'Put back everything one bulk change did, by its batch id. Only the latest bulk change not undone yet; anything changed again since is kept as it is.',
		input: z.object({ batch: z.string().min(1).max(80).describe('The batch id bulk returned.') }),
		run: (a, i) => undoBulk(a, i.batch)
	}),
	def({
		name: 'write_log_note',
		version: 1,
		kind: 'write',
		scope: 'notes',
		title: "Write a log's note",
		description: "Save the Markdown note on a habit's log for a day. append: true adds to it. Needs notes and log access.",
		input: z.object({ habit: habitRef, date, text: z.string().max(20000), append: z.boolean().optional(), extra }),
		run: (a, i) => writeLogNote(a, i)
	})
];

const byName = new Map(ACTIONS.map((a) => [a.name, a]));

/** Run an action by name. Input is checked against its schema first. */
export function runAction(actor: Actor, name: string, raw: unknown): unknown {
	const a = byName.get(name);
	if (!a) throw new ActionError('not_found', `No action called “${name}”.`);
	requireScope(actor, a.scope);
	const parsed = a.input.safeParse(raw ?? {});
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new ActionError('invalid', `${issue.path.join('.') || 'input'}: ${issue.message}`, parsed.error.issues.slice(0, 5));
	}
	return a.run(actor, parsed.data);
}

/** The actions this actor may call, with JSON Schemas for their input. */
export function catalog(actor: Actor) {
	return {
		apiVersion: API_VERSION,
		stable: false,
		note: 'Internal and still changing: read this list rather than hard-coding it.',
		access: { scopes: [...actor.scopes], allHabits: !actor.habitIds },
		actions: ACTIONS.filter((a) => actor.scopes.has(a.scope)).map((a) => ({
			name: a.name,
			version: a.version,
			kind: a.kind,
			title: a.title,
			description: a.description,
			scope: a.scope,
			input: z.toJSONSchema(a.input, { io: 'input', unrepresentable: 'any' })
		}))
	};
}
