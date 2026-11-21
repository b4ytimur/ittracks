// Stats: what a card asks of the logs and how it is drawn, and the boards that hold cards.
// Cards are plain settings (stored in the settings JSON, like views), so nothing here touches the database.
import { z } from 'zod';

// ---------- the parts of a card ----------

/** M1: where the numbers come from. */
export const SOURCES = {
	outcomes: 'Habit outcomes (done, missed, target met)',
	field: 'A field you log',
	task: 'A Task (sets, volume, e1RM, your own measures)',
	slips: 'Slips',
	cravings: 'Cravings resisted',
	money: 'Money saved'
} as const;
export type Source = keyof typeof SOURCES;

/** M2: how one log becomes one number. Custom measures are `custom:<id>`. */
export const PER_LOG = {
	// outcomes
	done: 'Times done',
	rate: 'Done or missed (consistency)',
	targetMet: 'Target met',
	// fields
	value: 'The value',
	sum: 'Sum of the sets',
	best: 'Best set',
	avg: 'Average of the sets',
	sets: 'Number of sets',
	ticked: 'Ticked or not',
	option: 'Which option',
	present: 'Filled in',
	// tasks
	volume: 'Volume (weight × reps)',
	e1rm: 'Estimated 1RM, best set',
	hardSets: 'Hard sets',
	pace: 'Pace (time ÷ distance)',
	pctTarget: '% of target',
	// slips, cravings, money
	count: 'How many',
	saved: 'Amount saved'
} as const;
export type BuiltinPerLog = keyof typeof PER_LOG;

/** Which per-log measures each source offers. */
export const PER_LOG_FOR: Record<Source, BuiltinPerLog[]> = {
	outcomes: ['done', 'rate', 'targetMet'],
	field: ['value', 'sum', 'best', 'avg', 'sets', 'ticked', 'option', 'present'],
	task: ['volume', 'e1rm', 'hardSets', 'pace', 'pctTarget', 'targetMet', 'sets'],
	slips: ['count'],
	cravings: ['count'],
	money: ['saved']
};

/** Per-log measures that give a share (0 to 1), shown as % when averaged. */
export const SHARE_MEASURES: string[] = ['rate', 'targetMet', 'ticked'];

/** M3: how the numbers in one bucket combine. */
export const OVER_TIME = {
	sum: 'Sum',
	avg: 'Average',
	median: 'Median',
	min: 'Lowest',
	max: 'Highest',
	last: 'Last',
	count: 'Number of logs',
	days: 'Days with a log'
} as const;
export type OverTime = keyof typeof OVER_TIME;

/** Combinations that add numbers up (stacked bars, running totals, "Other"). */
export const ADDS_UP: OverTime[] = ['sum', 'count', 'days'];

/** M4: bucket size. */
export const BUCKETS = {
	auto: 'Automatic',
	session: 'Each session',
	day: 'Day',
	week: 'Week',
	month: 'Month',
	quarter: 'Quarter',
	year: 'Year',
	all: 'Whole range'
} as const;
export type Bucket = keyof typeof BUCKETS;

/** M5: one series per… */
export const SPLITS = {
	none: 'Nothing',
	habit: 'Habit',
	task: 'Task',
	tag: 'Tag (muscle group)',
	area: 'Area',
	variant: 'Variant',
	level: 'Level',
	weekday: 'Weekday',
	part: 'Part of the day',
	option: 'Choice option',
	set: 'Set number',
	field: 'Field'
} as const;
export type Split = keyof typeof SPLITS;

/** T1/T2: time ranges. `since:YYYY-MM-DD` is also allowed. */
export const RANGES = {
	week: 'This week',
	'7d': 'Last 7 days',
	month: 'This month',
	'30d': 'Last 30 days',
	'90d': 'Last 90 days',
	year: 'This year',
	'12m': 'Last 12 months',
	all: 'All time'
} as const;
export type RangePreset = keyof typeof RANGES;

/** The card types (W1 to W11). */
export const CHARTS = {
	tile: 'Number',
	bars: 'Bars',
	line: 'Line',
	calendar: 'Calendar',
	goal: 'Goal progress',
	records: 'Records',
	table: 'Table',
	streak: 'Streak',
	breakdown: 'Breakdown',
	pattern: 'Pattern grid',
	sessions: 'Recent sessions'
} as const;
export type Chart = keyof typeof CHARTS;

export const SIZES = { small: 'Small', wide: 'Wide', full: 'Full width' } as const;
export type Size = keyof typeof SIZES;

const keysOf = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (n: number) => z.string().max(n);
const id = str(64);

const RANGE_RE = /^(week|7d|month|30d|90d|year|12m|all|since:\d{4}-\d{2}-\d{2})$/;
export const rangeValue = z.string().regex(RANGE_RE);
const cardRange = z.string().regex(/^(page|week|7d|month|30d|90d|year|12m|all|since:\d{4}-\d{2}-\d{2})$/);

/** Narrowing on top of the board: empty means everything the board shows. */
export const statFilter = z.object({
	habits: z.array(id).max(50).default([]),
	tags: z.array(str(100)).max(50).default([]),
	areas: z.array(id).max(50).default([])
});
export type StatFilter = z.infer<typeof statFilter>;

export const statCard = z.object({
	id,
	title: str(60).default(''),
	what: z
		.object({
			source: z.enum(keysOf(SOURCES)).default('outcomes'),
			/** Field: these metric ids. Empty with a name means a roll-up by name. */
			metrics: z.array(id).max(10).default([]),
			/** Roll-up: every field with this name (and type) in scope. */
			name: str(60).nullable().default(null),
			/** Task: one Task, or null for every Task in scope. */
			taskId: id.nullable().default(null)
		})
		.prefault({}),
	perLog: str(80).default('done'),
	overTime: z.enum(keysOf(OVER_TIME)).default('sum'),
	bucket: z.enum(keysOf(BUCKETS)).default('auto'),
	split: z.enum(keysOf(SPLITS)).default('none'),
	filter: statFilter.prefault({}),
	/** "page" follows the board's range. */
	range: cardRange.default('page'),
	compare: z
		.object({
			/** T6: change vs the period before. */
			previous: z.boolean().default(false),
			/** T7: a goal line, or the bottom of a band. */
			goal: z.number().finite().nullable().default(null),
			/** Top of a goal band (10 to 20 sets). */
			goalMax: z.number().finite().nullable().default(null),
			/** Take the goal from the Slot targets. */
			goalFromTargets: z.boolean().default(false),
			/** T8 */
			running: z.boolean().default(false),
			/** T9: days in the rolling average, 0 for none. */
			rolling: z.union([z.literal(0), z.literal(7), z.literal(30)]).default(0)
		})
		.prefault({}),
	look: z
		.object({
			chart: z.enum(keysOf(CHARTS)).default('tile'),
			size: z.enum(keysOf(SIZES)).default('small'),
			stacked: z.boolean().default(false),
			/** Series kept before the rest become "Other"; sessions shown on Recent sessions. */
			top: z.number().int().min(1).max(20).default(8)
		})
		.prefault({})
});
export type StatCard = z.infer<typeof statCard>;
export type StatCardInput = z.input<typeof statCard>;

export const boardFilter = z.object({
	areas: z.array(id).max(50).default([]),
	tags: z.array(str(100)).max(50).default([]),
	habit: id.nullable().default(null),
	identity: str(64).nullable().default(null),
	direction: z.enum(['all', 'build', 'break']).default('all')
});
export type BoardFilter = z.infer<typeof boardFilter>;

export const MAX_CARDS = 40;
export const MAX_BOARDS = 20;

export const board = z.object({
	id,
	name: str(40).min(1),
	cards: z.array(statCard).max(MAX_CARDS).default([]),
	range: rangeValue.default('30d'),
	filter: boardFilter.prefault({}),
	/** The template it came from, if any. */
	template: str(32).nullable().default(null)
});
export type Board = z.infer<typeof board>;

/** M7: a measure the user writes as a formula. */
export const customMeasure = z.object({
	id,
	name: str(40).min(1),
	/** e.g. "[Weight] * [Reps]". Field names in square brackets. */
	formula: str(300).min(1),
	/** Work it out on each set and combine, or once per log. */
	per: z.enum(['set', 'log']).default('set'),
	combine: z.enum(['sum', 'max', 'avg']).default('sum'),
	unit: str(16).default('')
});
export type CustomMeasure = z.infer<typeof customMeasure>;

export const E1RM_PRESETS = {
	epley: { name: 'Epley', formula: '[Weight] * (1 + [Reps] / 30)' },
	brzycki: { name: 'Brzycki', formula: '[Weight] * 36 / (37 - [Reps])' },
	lombardi: { name: 'Lombardi', formula: '[Weight] * [Reps] ^ 0.1' }
} as const;

export const statsSettings = z.object({
	boards: z.array(board).max(MAX_BOARDS).default([]),
	/** What the page opens with: the last board, or a board id. */
	open: str(64).default('last'),
	last: id.nullable().default(null),
	/** Habit Stats tabs the user changed; others are built from the habit's fields. */
	habitCards: z.record(id, z.array(statCard).max(MAX_CARDS)).default({}),
	/** Headline numbers on Today, per habit. */
	headlines: z.record(id, statCard).default({}),
	measures: z.array(customMeasure).max(50).default([]),
	/** How much a set counts toward a tag at each level (low, medium, high). */
	muscle: z
		.object({
			low: z.number().min(0).max(1).default(0),
			medium: z.number().min(0).max(1).default(0.5),
			high: z.number().min(0).max(1).default(1)
		})
		.prefault({}),
	e1rm: str(300).default(E1RM_PRESETS.epley.formula),
	/** e1RM is only worked out for sets of this many reps or fewer. */
	e1rmMaxReps: z.number().int().min(1).max(30).default(12),
	/** Board templates already offered after a view template switch, so they aren't offered twice. */
	offered: z.array(str(32)).max(20).default([])
});
export type StatsSettings = z.infer<typeof statsSettings>;

export const emptyStats = (): StatsSettings => statsSettings.parse({});

/** Read stored stats settings. Broken cards are dropped one by one instead of losing everything. */
export function readStats(raw: unknown): StatsSettings {
	const base = statsSettings.safeParse(raw ?? {});
	if (base.success) return base.data;
	const r = (raw ?? {}) as Record<string, unknown>;
	const out = emptyStats();
	const boards = Array.isArray(r.boards) ? r.boards : [];
	for (const b of boards) {
		const ok = board.safeParse({ ...(b as object), cards: [] });
		if (!ok.success) continue;
		const cards = Array.isArray((b as { cards?: unknown }).cards) ? (b as { cards: unknown[] }).cards : [];
		ok.data.cards = cards.map((c) => statCard.safeParse(c)).filter((c) => c.success).map((c) => c.data!);
		out.boards.push(ok.data);
	}
	for (const k of ['open', 'last', 'habitCards', 'headlines', 'measures', 'muscle', 'e1rm', 'e1rmMaxReps', 'offered'] as const) {
		const one = statsSettings.shape[k].safeParse(r[k]);
		if (one.success) (out as Record<string, unknown>)[k] = one.data;
	}
	return out;
}

export const newId = () =>
	typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

/** A card with defaults filled in. */
export const makeCard = (c: Omit<StatCardInput, 'id'> & { id?: string }): StatCard => statCard.parse({ id: newId(), ...c });

export const isCustom = (perLog: string) => perLog.startsWith('custom:');
export const customId = (perLog: string) => perLog.slice('custom:'.length);

/** The label of a per-log measure, including custom ones. */
export function perLogLabel(perLog: string, measures: CustomMeasure[]): string {
	if (isCustom(perLog)) return measures.find((m) => m.id === customId(perLog))?.name ?? 'Deleted measure';
	return (PER_LOG as Record<string, string>)[perLog] ?? perLog;
}

export function rangeLabel(r: string): string {
	if (r.startsWith('since:')) {
		const d = r.slice(6);
		return `Since ${new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
	}
	return (RANGES as Record<string, string>)[r] ?? r;
}
