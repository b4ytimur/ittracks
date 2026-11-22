// Database schema. Terms follow the vocabulary doc:
// Habit > Variant > Slot > Task (from the Library) > Metric,
// Schedule -> Occurrence -> Log -> Entry, and Slips for break habits.
import { sqliteTable, text, integer, real, primaryKey, index, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Level, StreakRule } from '../../engine/streak';
import type { Limit } from '../../engine/limit';
import type { Progression } from '../../engine/progression';
import type { EarlierSchedule } from '../../engine/unlogged';
import type { ChoiceOption, EarlierScores, Scores } from '../../options';

/** Temptation bundling: something you want, paired with the habit. */
export interface Bundle {
	reward: string;
	/** Only enjoy it once the habit is done. */
	strict: boolean;
}

/** What happens when an Occurrence is finished. */
export interface Reward {
	celebrate: boolean;
	message: string;
	/** Each done Occurrence adds `amount` toward `goal`. */
	jar: { amount: number; unit: string; goal: string } | null;
}

/** What each Slip of a break habit costs, and the old daily rate, to show savings. */
export interface Cost {
	amount: number;
	unit: string;
	perDay: number | null;
}

/** When and where a Habit happens, and what it is stacked after. All optional. */
export interface Cue {
	/** HH:MM */
	time: string | null;
	place: string | null;
	/** Stacked after another Habit of this account. */
	afterHabitId: string | null;
	/** Or after something that isn't a Habit: "after I pour my coffee". */
	afterText: string | null;
	/** A named part of the day from Settings, such as "Morning". */
	range?: string | null;
}

/** What Minimum, Target and Stretch mean for this Habit, in the user's words. */
export interface Levels {
	enabled: boolean;
	minimum: string;
	target: string;
	stretch: string;
}

/** A break habit's if-then plan: "If I want a cigarette, I will do 10 push-ups." */
export interface IfThen {
	when: string;
	then: string;
	/** Optional build Habit that is the replacement. */
	habitId: string | null;
}

const id = () => text('id').primaryKey();
const createdAt = () =>
	integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date());

/** Single user in the MVP; the table leaves room for several Accounts later. */
export const account = sqliteTable('account', {
	id: id(),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	createdAt: createdAt()
});

export const authSession = sqliteTable('auth_session', {
	id: id(),
	accountId: text('account_id')
		.notNull()
		.references(() => account.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

/** Default units and other per-user preferences, stored as JSON. */
export const settings = sqliteTable('settings', {
	accountId: text('account_id')
		.primaryKey()
		.references(() => account.id, { onDelete: 'cascade' }),
	data: text('data', { mode: 'json' }).notNull().$type<Record<string, unknown>>()
});

// ---------- Library ----------

export const task = sqliteTable('task', {
	id: id(),
	accountId: text('account_id')
		.notNull()
		.references(() => account.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	notes: text('notes'),
	/** Sub-tasks point at their parent; one level deep in the MVP. */
	parentTaskId: text('parent_task_id'),
	restTimerEnabled: integer('rest_timer_enabled', { mode: 'boolean' }).notNull().default(false),
	restTimerSeconds: integer('rest_timer_seconds').notNull().default(90),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: createdAt(),
	areaId: text('area_id').references(() => area.id, { onDelete: 'set null' }),
	/** Archived Tasks keep their history but are hidden from the Library and pickers. */
	archived: integer('archived', { mode: 'boolean' }).notNull().default(false)
});

export const tag = sqliteTable('tag', {
	id: id(),
	accountId: text('account_id')
		.notNull()
		.references(() => account.id, { onDelete: 'cascade' }),
	name: text('name').notNull()
});

/** level: 1 = low, 2 = medium, 3 = high. */
export const taskTag = sqliteTable(
	'task_tag',
	{
		taskId: text('task_id')
			.notNull()
			.references(() => task.id, { onDelete: 'cascade' }),
		tagId: text('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' }),
		level: integer('level').notNull().default(2)
	},
	(t) => [primaryKey({ columns: [t.taskId, t.tagId] })]
);

import { metricTypes } from '../../metric-types';
export { metricTypes, type MetricType } from '../../metric-types';

export const metric = sqliteTable('metric', {
	id: id(),
	taskId: text('task_id')
		.notNull()
		.references(() => task.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	type: text('type', { enum: metricTypes }).notNull(),
	/** Free text chosen by the user: kg, lb, min, pages... */
	unit: text('unit'),
	/** Options for the "choice" type. Logs store an option's id, so a rename keeps past values. */
	choices: text('choices', { mode: 'json' }).$type<ChoiceOption[]>(),
	/** Repeating metrics are logged once per Entry (e.g. once per gym set). */
	repeats: integer('repeats', { mode: 'boolean' }).notNull().default(false),
	sortOrder: integer('sort_order').notNull().default(0),
	/** Where a new log's value comes from: last time, the target, or blank. */
	prefill: text('prefill', { enum: ['last', 'target', 'blank'] }).notNull().default('last'),
	/** Plus and minus step on the log screen; null uses the type's default. */
	step: real('step'),
	/** A required field must be filled before Finish. */
	required: integer('required', { mode: 'boolean' }).notNull().default(false),
	/** Shown on quick logs (shortcuts, links, reminder buttons). Others keep their prefill. */
	quick: integer('quick', { mode: 'boolean' }).notNull().default(true),
	/** Text field with several lines of Markdown: a note box on the log screen. */
	long: integer('long', { mode: 'boolean' }).notNull().default(false),
	/** What a new log of a long text field starts with. */
	starter: text('starter'),
	/** Long text field: one prompt shows each day and is saved with the answer. */
	prompts: text('prompts', { mode: 'json' }).$type<string[]>(),
	promptOrder: text('prompt_order', { enum: ['order', 'random'] }).notNull().default('order'),
	/** Choice field: a number per option id, so Stats can average it (mood 1 to 5). */
	scores: text('scores', { mode: 'json' }).$type<Scores>(),
	/** Numbers an edit replaced, each with the last day it applied, so past days keep theirs. */
	earlierScores: text('earlier_scores', { mode: 'json' }).$type<EarlierScores[]>(),
	/** Removed from its Task after it was logged: hidden from new logs, kept for History and Stats. */
	archived: integer('archived', { mode: 'boolean' }).notNull().default(false)
});

/** A top-level group with a color and icon, for Habits and Tasks: Fitness, Learning... */
export const area = sqliteTable('area', {
	id: id(),
	accountId: text('account_id')
		.notNull()
		.references(() => account.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	color: text('color').notNull().default('#2563eb'),
	icon: text('icon').notNull().default(''),
	sortOrder: integer('sort_order').notNull().default(0)
});

/** A saved filter for a smart Collection. Every part that is set must match. */
export interface CollectionFilter {
	tags: string[];
	areaId: string | null;
	text: string;
}

/** A named group of Tasks: hand-picked, or a saved filter. One level of nesting. */
export const collection = sqliteTable('collection', {
	id: id(),
	accountId: text('account_id')
		.notNull()
		.references(() => account.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	parentId: text('parent_id'),
	/** Null for a hand-picked Collection. */
	filter: text('filter', { mode: 'json' }).$type<CollectionFilter>(),
	sortOrder: integer('sort_order').notNull().default(0)
});

export const collectionTask = sqliteTable(
	'collection_task',
	{
		collectionId: text('collection_id')
			.notNull()
			.references(() => collection.id, { onDelete: 'cascade' }),
		taskId: text('task_id')
			.notNull()
			.references(() => task.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.collectionId, t.taskId] })]
);

// ---------- Habits ----------

export const habit = sqliteTable('habit', {
	id: id(),
	accountId: text('account_id')
		.notNull()
		.references(() => account.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	direction: text('direction', { enum: ['build', 'break'] }).notNull(),
	notes: text('notes'),
	/** When tracking began: the start of a break habit's first run. */
	startDate: text('start_date').notNull(),
	/** The Schedule (see src/lib/engine/schedule.ts); null for break habits. */
	schedule: text('schedule', { mode: 'json' }),
	archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: createdAt(),
	cue: text('cue', { mode: 'json' }).$type<Cue>(),
	/** Existing habits keep the strict rule; new ones default to never miss twice (see forms). */
	streakRule: text('streak_rule', { mode: 'json' })
		.notNull()
		.$type<StreakRule>()
		.default({ kind: 'strict' }),
	/** Does a done at the Minimum level keep the streak alive? */
	minimumCounts: integer('minimum_counts', { mode: 'boolean' }).notNull().default(true),
	levels: text('levels', { mode: 'json' }).$type<Levels>(),
	/** Show a one-tap Done on Today that logs the Slot targets. */
	quickDone: integer('quick_done', { mode: 'boolean' }).notNull().default(false),
	/** Push a reminder at the cue time. */
	remind: integer('remind', { mode: 'boolean' }).notNull().default(false),
	ifThen: text('if_then', { mode: 'json' }).$type<IfThen>(),
	/** Break habit: feelings a slip can be logged with, user-editable. A slip stores the feeling's id. */
	triggers: text('triggers', { mode: 'json' }).$type<ChoiceOption[]>(),
	/** "I get to train today": shown on the card. */
	reframe: text('reframe'),
	bundle: text('bundle', { mode: 'json' }).$type<Bundle>(),
	/** Checklist for the day before a due Occurrence (environment design). */
	prep: text('prep', { mode: 'json' }).$type<string[]>(),
	reward: text('reward', { mode: 'json' }).$type<Reward>(),
	cost: text('cost', { mode: 'json' }).$type<Cost>(),
	/** Reduce mode for break habits; null means quit entirely. */
	limit: text('limit', { mode: 'json' }).$type<Limit>(),
	progression: text('progression', { mode: 'json' }).$type<Progression>(),
	/** Hits toward the next progression count from after this date. */
	progressionFrom: text('progression_from'),
	areaId: text('area_id').references(() => area.id, { onDelete: 'set null' }),
	/** A due day that ends with no log: counted as missed, or ignored (a gentler habit). */
	unlogged: text('unlogged', { enum: ['missed', 'ignore'] }).notNull().default('missed'),
	/** Every day up to this one has been checked for due days nobody logged. Null: never yet. */
	settledThrough: text('settled_through'),
	/**
	 * Schedules from before an edit that applied from a later day on, oldest first: each one
	 * still decides which days up to its `until` were due (see engine/unlogged.ts).
	 */
	earlierSchedules: text('earlier_schedules', { mode: 'json' }).$type<EarlierSchedule[]>(),
	/**
	 * The group this habit sits in: another build habit whose Schedule is a group. Groups can
	 * sit in groups. Deleting a group moves what was inside it to the top level.
	 */
	parentId: text('parent_id').references((): AnySQLiteColumn => habit.id, { onDelete: 'set null' })
});

/** A pause for one Habit, or for all of them when habitId is null. Dates are inclusive. */
export const pause = sqliteTable('pause', {
	id: id(),
	accountId: text('account_id')
		.notNull()
		.references(() => account.id, { onDelete: 'cascade' }),
	habitId: text('habit_id').references(() => habit.id, { onDelete: 'cascade' }),
	start: text('start').notNull(),
	end: text('end').notNull(),
	note: text('note'),
	createdAt: createdAt()
});

/** Prep items ticked off, per habit and the date of the Occurrence they prepare for. */
export const prepTick = sqliteTable(
	'prep_tick',
	{
		habitId: text('habit_id')
			.notNull()
			.references(() => habit.id, { onDelete: 'cascade' }),
		date: text('date').notNull(),
		item: text('item').notNull()
	},
	(t) => [primaryKey({ columns: [t.habitId, t.date, t.item] })]
);

/** "I am a runner." Habits vote for an Identity each time they are done. */
export const identity = sqliteTable('identity', {
	id: id(),
	accountId: text('account_id')
		.notNull()
		.references(() => account.id, { onDelete: 'cascade' }),
	statement: text('statement').notNull(),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: createdAt()
});

export const habitIdentity = sqliteTable(
	'habit_identity',
	{
		habitId: text('habit_id')
			.notNull()
			.references(() => habit.id, { onDelete: 'cascade' }),
		identityId: text('identity_id')
			.notNull()
			.references(() => identity.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.habitId, t.identityId] })]
);

export const variant = sqliteTable('variant', {
	id: id(),
	habitId: text('habit_id')
		.notNull()
		.references(() => habit.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	sortOrder: integer('sort_order').notNull().default(0)
});

/** A Slot is fixed to a Task, or open with a Fill rule (see src/lib/engine/fill.ts). */
export const slot = sqliteTable('slot', {
	id: id(),
	variantId: text('variant_id')
		.notNull()
		.references(() => variant.id, { onDelete: 'cascade' }),
	taskId: text('task_id').references(() => task.id, { onDelete: 'set null' }),
	fillRule: text('fill_rule', { mode: 'json' }),
	/** Target number of sets, for Tasks logged per set. */
	sets: integer('sets'),
	/** Targets per Metric id, e.g. { "<weight id>": 60, "<reps id>": 8 }. */
	targets: text('targets', { mode: 'json' }).$type<Record<string, number>>(),
	/** Targets for the Minimum and Stretch levels; `targets` is the Target level. */
	minTargets: text('min_targets', { mode: 'json' }).$type<Record<string, number>>(),
	stretchTargets: text('stretch_targets', { mode: 'json' }).$type<Record<string, number>>(),
	sortOrder: integer('sort_order').notNull().default(0)
});

// ---------- What happens ----------

export const occurrence = sqliteTable('occurrence', {
	id: id(),
	habitId: text('habit_id')
		.notNull()
		.references(() => habit.id, { onDelete: 'cascade' }),
	variantId: text('variant_id').references(() => variant.id, { onDelete: 'set null' }),
	/** Calendar date, YYYY-MM-DD, in the user's time zone. */
	date: text('date').notNull(),
	status: text('status', { enum: ['due', 'done', 'skipped', 'missed'] }).notNull(),
	/** The Tasks picked for open Slots: { slotId: taskId }. */
	picks: text('picks', { mode: 'json' }).$type<Record<string, string>>(),
	notes: text('notes'),
	finishedAt: integer('finished_at', { mode: 'timestamp' }),
	/** Which level was reached; null means Target. */
	level: text('level', { enum: ['minimum', 'target', 'stretch'] }).$type<Level>(),
	/** Logged on a day the schedule had nothing due. A rotation that skips ahead keeps its plan. */
	extra: integer('extra', { mode: 'boolean' }).notNull().default(false),
	/**
	 * The targets each Slot had, kept when they changed later (Raise, an edit), so a log is
	 * always judged against what it aimed for. Null: the Slots' targets now still apply.
	 */
	goals: text('goals', { mode: 'json' }).$type<Record<string, SlotGoals>>(),
	/** A group's day: how many habits inside it were done, of how many that counted. */
	rollup: text('rollup', { mode: 'json' }).$type<{ done: number; total: number }>()
});

/** One Slot's targets as they were: Target, Minimum and Stretch values by Metric id, and sets. */
export interface SlotGoals {
	taskId: string | null;
	sets: number | null;
	targets: Record<string, number> | null;
	minTargets: Record<string, number> | null;
	stretchTargets: Record<string, number> | null;
}

/** One row of Metric values for one Task, e.g. one gym set. */
export const entry = sqliteTable('entry', {
	id: id(),
	occurrenceId: text('occurrence_id')
		.notNull()
		.references(() => occurrence.id, { onDelete: 'cascade' }),
	taskId: text('task_id')
		.notNull()
		.references(() => task.id, { onDelete: 'cascade' }),
	/** { metricId: value } */
	values: text('values', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
	sortOrder: integer('sort_order').notNull().default(0)
});

export const slip = sqliteTable('slip', {
	id: id(),
	habitId: text('habit_id')
		.notNull()
		.references(() => habit.id, { onDelete: 'cascade' }),
	date: text('date').notNull(),
	count: real('count').notNull().default(1),
	notes: text('notes'),
	createdAt: createdAt(),
	/** Slip context, all optional: HH:MM, where, the feeling (its id in the habit's triggers), and who was there. */
	time: text('time'),
	place: text('place'),
	feeling: text('feeling'),
	withWhom: text('with_whom')
});

/** A craving resisted on a break habit, usually by doing the if-then replacement. */
/**
 * One free Markdown note per day: not a habit, no streak. Private, like every note: never
 * part of templates or any sharing feature.
 */
export const dayNote = sqliteTable(
	'day_note',
	{
		accountId: text('account_id')
			.notNull()
			.references(() => account.id, { onDelete: 'cascade' }),
		/** YYYY-MM-DD in the user's time zone. */
		date: text('date').notNull(),
		text: text('text').notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [primaryKey({ columns: [t.accountId, t.date] })]
);

export const craving = sqliteTable('craving', {
	id: id(),
	habitId: text('habit_id')
		.notNull()
		.references(() => habit.id, { onDelete: 'cascade' }),
	date: text('date').notNull(),
	time: text('time'),
	createdAt: createdAt()
});

// ---------- Reminders ----------

/** A browser that agreed to receive push reminders. */
export const pushSubscription = sqliteTable('push_subscription', {
	id: id(),
	accountId: text('account_id')
		.notNull()
		.references(() => account.id, { onDelete: 'cascade' }),
	endpoint: text('endpoint').notNull().unique(),
	p256dh: text('p256dh').notNull(),
	auth: text('auth').notNull(),
	createdAt: createdAt()
});

/** One reminder per Habit per day. */
export const reminderSent = sqliteTable(
	'reminder_sent',
	{
		habitId: text('habit_id')
			.notNull()
			.references(() => habit.id, { onDelete: 'cascade' }),
		date: text('date').notNull(),
		/** HH:MM to send it again, set by Snooze on the notification. */
		againAt: text('again_at')
	},
	(t) => [primaryKey({ columns: [t.habitId, t.date] })]
);

/** Server-wide values, such as the push keys generated on first start. */
export const appValue = sqliteTable('app_value', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

// ---------- Integrations ----------

/**
 * A key for Shortcuts, quick-log links, the MCP server and scripts. Only a hash of the secret
 * is kept, so a key is shown once. Scopes and habits limit what it can do
 * (src/lib/server/core/tokens.ts).
 */
export const apiToken = sqliteTable('api_token', {
	id: id(),
	accountId: text('account_id')
		.notNull()
		.references(() => account.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	/** sha256 of the secret. */
	hash: text('hash').notNull().unique(),
	/** The first characters of the secret, so keys can be told apart. */
	hint: text('hint').notNull(),
	scopes: text('scopes', { mode: 'json' }).notNull().$type<string[]>(),
	/** Only these habits; null means every habit. */
	habitIds: text('habit_ids', { mode: 'json' }).$type<string[]>(),
	createdAt: createdAt(),
	lastUsedAt: integer('last_used_at', { mode: 'timestamp' })
});

/**
 * Append-only log of what happened (a habit done, a value logged, a slip), whoever did it:
 * the app, a key, a quick-log link or the MCP server. Webhooks and feeds will read from it.
 * habitId has no foreign key on purpose: history outlives a deleted habit.
 */
export const event = sqliteTable(
	'event',
	{
		seq: integer('seq').primaryKey({ autoIncrement: true }),
		accountId: text('account_id')
			.notNull()
			.references(() => account.id, { onDelete: 'cascade' }),
		at: integer('at', { mode: 'timestamp_ms' }).notNull(),
		type: text('type').notNull(),
		/** Version of this event type's data. */
		v: integer('v').notNull().default(1),
		habitId: text('habit_id'),
		/** The day it is about, YYYY-MM-DD. */
		date: text('date'),
		/** app, key, link, mcp, reminder or import. */
		source: text('source').notNull(),
		tokenId: text('token_id'),
		data: text('data', { mode: 'json' }).notNull().$type<Record<string, unknown>>()
	},
	(t) => [index('event_account_seq').on(t.accountId, t.seq)]
);
