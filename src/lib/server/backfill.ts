// Logging past days: what a past day looked like, and changing it after the fact.
// A past log counts exactly like one made on the day: streaks, the chain and stats read
// Occurrences by date, so they pick it up as soon as it is saved.
import { and, asc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { entry, habit, occurrence, slip, slot, task, variant } from './db/schema';
import { dueOn, type Schedule } from '$lib/engine/schedule';
import { carriesOver, dependsOnHistory, isRealDate, logWindow, variantFor, type LogWindow } from '$lib/engine/backfill';
import { scheduleStartBy } from '$lib/engine/unlogged';
import { pauseOn } from '$lib/engine/pause';
import { limitOn, usedIn } from '$lib/engine/limit';
import type { Level } from '$lib/engine/streak';
import type { ScheduleForm } from '$lib/forms';
import { createOccurrence, history, pausesOf, pickForVariant, recount, reopen, settle } from './today';
import { getSettings } from './settings';

type HabitRow = typeof habit.$inferSelect;
type Status = 'due' | 'done' | 'skipped' | 'missed';

export interface PastItem {
	habitId: string;
	name: string;
	occurrence: { id: string; status: Status; level: Level | null; entries: number } | null;
	/** The schedule had it due that day. */
	wasDue: boolean;
	paused: boolean;
	/** The Variant it is (or would be) logged with. */
	variantId: string | null;
	/** Offered only when the habit has more than one. */
	variants: { id: string; name: string }[];
	slotCount: number;
	/** A finished log exists to copy with "Same as last time". */
	canRepeat: boolean;
	quickDone: boolean;
	levels: { minimum: string; target: string; stretch: string } | null;
}

export interface PastBreakItem {
	habitId: string;
	name: string;
	slips: { id: string; count: number; time: string | null; feeling: string | null }[];
	limit: { used: number; max: number; period: 'day' | 'week' } | null;
}

/** May this account still change build habits on `date`? */
export function windowFor(accountId: string, date: string, today: string): LogWindow {
	return logWindow(date, today, getSettings(accountId).pastDays);
}

const allActive = (accountId: string) =>
	db
		.select()
		.from(habit)
		.where(and(eq(habit.accountId, accountId), eq(habit.archived, false)))
		.orderBy(asc(habit.sortOrder), asc(habit.name))
		.all();

const activeHabits = (accountId: string, date: string) => allActive(accountId).filter((h) => h.startDate <= date);

/** A habit that starts after a day, offered to start from that day instead. */
export interface LaterItem {
	habitId: string;
	name: string;
	direction: 'build' | 'break';
	startDate: string;
}

const rowOn = (habitId: string, date: string) =>
	db
		.select()
		.from(occurrence)
		.where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date)))
		.get();

const entryCount = (occurrenceId: string) =>
	db.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, occurrenceId)).all().length;

/** Everything about one past day: build habits that were due, the rest, and slips. */
export function loadDay(accountId: string, date: string, today: string) {
	const pauses = pausesOf(accountId);
	const due: PastItem[] = [];
	const other: PastItem[] = [];
	const breaking: PastBreakItem[] = [];
	const later: LaterItem[] = [];

	for (const h of allActive(accountId)) {
		if (h.startDate > date) {
			later.push({ habitId: h.id, name: h.name, direction: h.direction, startDate: h.startDate });
			continue;
		}
		if (h.direction === 'break') {
			const all = db.select().from(slip).where(eq(slip.habitId, h.id)).orderBy(asc(slip.createdAt)).all();
			breaking.push({
				habitId: h.id,
				name: h.name,
				slips: all
					.filter((s) => s.date === date)
					.map((s) => ({ id: s.id, count: s.count, time: s.time, feeling: s.feeling })),
				limit: h.limit ? { used: usedIn(h.limit, all, date), max: limitOn(h.limit, date), period: h.limit.period } : null
			});
			continue;
		}
		const schedule = h.schedule as ScheduleForm | null;
		if (!schedule) continue;
		// Leftovers from earlier visits settle first, as Today would.
		settle(accountId, h.id, schedule, today);
		const occ = rowOn(h.id, date);
		const past = history(h.id, date);
		const paused = !!pauseOn(pauses, h.id, date);
		const wasDue = !paused && !!dueOn(schedule as Schedule, past, date);
		const variants = db
			.select({ id: variant.id, name: variant.name })
			.from(variant)
			.where(eq(variant.habitId, h.id))
			.orderBy(asc(variant.sortOrder))
			.all();
		const variantId =
			occ?.variantId ?? variantFor(schedule as Schedule, past, date, variants.map((v) => v.id));
		const item: PastItem = {
			habitId: h.id,
			name: h.name,
			occurrence: occ ? { id: occ.id, status: occ.status, level: occ.level ?? null, entries: entryCount(occ.id) } : null,
			wasDue,
			paused,
			variantId,
			variants: variants.length > 1 ? variants : [],
			slotCount: variantId ? db.select({ id: slot.id }).from(slot).where(eq(slot.variantId, variantId)).all().length : 0,
			canRepeat: canRepeat(h.id, occ?.id ?? null),
			quickDone: h.quickDone,
			levels: h.levels?.enabled ? { minimum: h.levels.minimum, target: h.levels.target, stretch: h.levels.stretch } : null
		};
		(occ || wasDue ? due : other).push(item);
	}
	return { due, other, breaking, later };
}

/**
 * Start a habit earlier, from `date`: its start date moves back, and so does its schedule's
 * own start (by whole cycles, so planned days keep their Variant). Due days from then on that
 * nobody logs count as missed, unless the habit ignores them.
 */
export function startFrom(h: HabitRow, date: string) {
	if (date >= h.startDate) return;
	const schedule = h.schedule ? scheduleStartBy(h.schedule as Schedule, date) : null;
	db.update(habit)
		.set({
			startDate: date,
			schedule,
			// Count the days before the old start too.
			settledThrough: null,
			limit: h.limit && h.limit.start > date ? { ...h.limit, start: date } : h.limit
		})
		.where(eq(habit.id, h.id))
		.run();
}

function canRepeat(habitId: string, except: string | null): boolean {
	return db
		.select({ id: occurrence.id })
		.from(entry)
		.innerJoin(occurrence, eq(entry.occurrenceId, occurrence.id))
		.where(and(eq(occurrence.habitId, habitId), eq(occurrence.status, 'done')))
		.all()
		.some((o) => o.id !== except);
}

/**
 * Build habits that were due on `date` and have no log: a miss, or a day the app wasn't
 * opened. Habits that carry over (frequency targets, waiting rotations) never miss a day,
 * so they are left out.
 */
export function unloggedOn(accountId: string, date: string): string[] {
	const pauses = pausesOf(accountId);
	return activeHabits(accountId, date)
		.filter((h) => {
			const schedule = h.schedule as Schedule | null;
			if (h.direction !== 'build' || !schedule || carriesOver(schedule) || pauseOn(pauses, h.id, date)) return false;
			const occ = rowOn(h.id, date);
			if (occ) return occ.status === 'missed' || occ.status === 'due';
			return !!dueOn(schedule, history(h.id, date), date);
		})
		.map((h) => h.name);
}

/**
 * The Occurrence of a habit on a past day, created (as due) when there is none. A chosen
 * Variant replaces the planned one while nothing is logged yet.
 */
export function occurrenceOn(accountId: string, h: HabitRow, date: string, chosen: string | null) {
	const schedule = h.schedule as Schedule;
	const ids = db.select({ id: variant.id }).from(variant).where(eq(variant.habitId, h.id)).orderBy(asc(variant.sortOrder)).all().map((v) => v.id);
	const pick = chosen && ids.includes(chosen) ? chosen : null;
	const existing = rowOn(h.id, date);
	if (existing) {
		if (pick && pick !== existing.variantId && existing.status !== 'done' && !entryCount(existing.id)) {
			db.update(occurrence)
				.set({ variantId: pick, picks: pickForVariant(accountId, pick) })
				.where(eq(occurrence.id, existing.id))
				.run();
			return rowOn(h.id, date)!;
		}
		return existing;
	}
	const past = history(h.id, date);
	const v = pick ?? variantFor(schedule, past, date, ids);
	// A day nothing was due is an extra: a rotation that skips ahead keeps its calendar.
	return v ? createOccurrence(accountId, h.id, v, date, !dueOn(schedule, past, date)) : null;
}

/** What today's Occurrence was planned as, for schedules a past log can change. */
export function planOfToday(habitId: string, schedule: ScheduleForm, today: string): string | null {
	return dependsOnHistory(schedule as Schedule) ? dueOn(schedule as Schedule, history(habitId, today), today) : null;
}

/**
 * After a past day changes, today may no longer be due, or due with another Variant: a
 * weekly target was met by the late log, or a rotation moved on. Today's Occurrence is
 * planned again, but only if the schedule made it, nothing is logged in it yet, and the
 * plan really changed. A rotation started early by hand is left alone.
 */
export function replanToday(accountId: string, habitId: string, schedule: ScheduleForm, today: string, before: string | null) {
	if (!before || !dependsOnHistory(schedule as Schedule)) return;
	const occ = rowOn(habitId, today);
	if (!occ || occ.status !== 'due' || occ.variantId !== before || entryCount(occ.id)) return;
	const after = dueOn(schedule as Schedule, history(habitId, today), today);
	if (after === before) return;
	if (!after) db.delete(occurrence).where(eq(occurrence.id, occ.id)).run();
	else db.update(occurrence).set({ variantId: after, picks: pickForVariant(accountId, after) }).where(eq(occurrence.id, occ.id)).run();
}

/**
 * Take a past day's log away: back to missed if the schedule had it due, otherwise the
 * day goes back to having nothing (a day off, a pause, a frequency target).
 */
export function clearDay(accountId: string, habitId: string, schedule: ScheduleForm, date: string, today: string) {
	const occ = rowOn(habitId, date);
	if (!occ) return;
	reopen(occ.id, true);
	recount(accountId, habitId, schedule, date, today);
}

// ---------- Undo: a copy of a day's log, taken before a change ----------

const snapshotSchema = z.object({
	habitId: z.string().uuid(),
	date: z.string().refine(isRealDate),
	occ: z
		.object({
			variantId: z.string().uuid().nullable(),
			status: z.enum(['due', 'done', 'skipped', 'missed']),
			level: z.enum(['minimum', 'target', 'stretch']).nullable(),
			notes: z.string().max(5000).nullable(),
			picks: z.record(z.string(), z.string()).nullable(),
			finishedAt: z.number().nullable(),
			extra: z.boolean().default(false),
			entries: z.array(z.object({ taskId: z.string().uuid(), values: z.record(z.string(), z.unknown()) })).max(1000)
		})
		.nullable()
});
export type Snapshot = z.infer<typeof snapshotSchema>;

/** A copy of one habit's day: its Occurrence and Entries, or null when there is none. */
export function snapshot(habitId: string, date: string): Snapshot {
	const occ = rowOn(habitId, date);
	return {
		habitId,
		date,
		occ: occ
			? {
					variantId: occ.variantId,
					status: occ.status,
					level: occ.level ?? null,
					notes: occ.notes,
					picks: occ.picks ?? null,
					finishedAt: occ.finishedAt ? occ.finishedAt.getTime() : null,
					extra: occ.extra,
					entries: db
						.select({ taskId: entry.taskId, values: entry.values })
						.from(entry)
						.where(eq(entry.occurrenceId, occ.id))
						.orderBy(asc(entry.sortOrder))
						.all()
				}
			: null
	};
}

/** Put a day back the way a snapshot had it. Only this account's habit, Variants and Tasks. */
export function restore(accountId: string, raw: unknown): boolean {
	const parsed = snapshotSchema.safeParse(raw);
	if (!parsed.success) return false;
	const snap = parsed.data;
	const h = db.select().from(habit).where(and(eq(habit.id, snap.habitId), eq(habit.accountId, accountId))).get();
	if (!h) return false;
	const existing = rowOn(h.id, snap.date);
	const o = snap.occ;
	if (!o) {
		if (existing) db.delete(occurrence).where(eq(occurrence.id, existing.id)).run();
		return true;
	}
	if (o.variantId && !db.select().from(variant).where(and(eq(variant.id, o.variantId), eq(variant.habitId, h.id))).get())
		return false;
	const taskIds = [...new Set([...o.entries.map((e) => e.taskId), ...Object.values(o.picks ?? {})])];
	if (
		taskIds.length &&
		db.select({ id: task.id }).from(task).where(and(inArray(task.id, taskIds), eq(task.accountId, accountId))).all().length !==
			taskIds.length
	)
		return false;
	db.transaction((tx) => {
		const fields = {
			variantId: o.variantId,
			status: o.status,
			level: o.level === 'target' ? null : o.level,
			notes: o.notes,
			picks: o.picks,
			finishedAt: o.finishedAt ? new Date(o.finishedAt) : o.status === 'done' ? new Date() : null,
			extra: o.extra
		};
		let id = existing?.id;
		if (id) {
			tx.update(occurrence).set(fields).where(eq(occurrence.id, id)).run();
			tx.delete(entry).where(eq(entry.occurrenceId, id)).run();
		} else {
			id = randomUUID();
			tx.insert(occurrence).values({ id, habitId: h.id, date: snap.date, ...fields }).run();
		}
		o.entries.forEach((e, i) =>
			tx.insert(entry).values({ id: randomUUID(), occurrenceId: id!, taskId: e.taskId, values: e.values, sortOrder: i }).run()
		);
	});
	return true;
}
