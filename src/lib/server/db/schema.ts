// Database schema. Terms follow the vocabulary doc:
// Habit > Variant > Slot > Task (from the Library) > Metric,
// Schedule -> Occurrence -> Log -> Entry, and Slips for break habits.
import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';

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
	createdAt: createdAt()
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
	/** Options for the "choice" type. */
	choices: text('choices', { mode: 'json' }).$type<string[]>(),
	/** Repeating metrics are logged once per Entry (e.g. once per gym set). */
	repeats: integer('repeats', { mode: 'boolean' }).notNull().default(false),
	sortOrder: integer('sort_order').notNull().default(0)
});

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
	createdAt: createdAt()
});

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
	finishedAt: integer('finished_at', { mode: 'timestamp' })
});

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
	createdAt: createdAt()
});
