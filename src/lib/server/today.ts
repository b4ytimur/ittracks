// Turns Schedules into today's Occurrences, and gathers what the Today screen shows.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lt, max } from 'drizzle-orm';
import { db } from './db';
import { entry, habit, occurrence, slip, slot, tag, task, taskTag, variant } from './db/schema';
import { dueOn, nextInRotation, type Done, type Schedule } from '$lib/engine/schedule';
import { pickTask, type Candidate, type FillRule } from '$lib/engine/fill';
import { buildStreak, daysSinceSlip, longestRun } from '$lib/engine/streak';
import type { ScheduleForm } from '$lib/forms';

/** Today's date in the user's time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string | undefined): string {
	try {
		return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
	} catch {
		return new Date().toISOString().slice(0, 10);
	}
}

/** Library Tasks as Fill-rule candidates: their Tags and when each was last done. */
export function candidates(accountId: string): Candidate[] {
	const tasks = db
		.select({ id: task.id })
		.from(task)
		.where(and(eq(task.accountId, accountId), isNull(task.parentTaskId)))
		.all();
	if (!tasks.length) return [];
	const ids = tasks.map((t) => t.id);
	const tags = db
		.select({ taskId: taskTag.taskId, name: tag.name, level: taskTag.level })
		.from(taskTag)
		.innerJoin(tag, eq(taskTag.tagId, tag.id))
		.where(inArray(taskTag.taskId, ids))
		.all();
	const last = db
		.select({ taskId: entry.taskId, date: max(occurrence.date) })
		.from(entry)
		.innerJoin(occurrence, eq(entry.occurrenceId, occurrence.id))
		.where(and(inArray(entry.taskId, ids), eq(occurrence.status, 'done')))
		.groupBy(entry.taskId)
		.all();
	return ids.map((id) => ({
		id,
		tags: Object.fromEntries(tags.filter((t) => t.taskId === id).map((t) => [t.name, t.level])),
		lastDone: last.find((l) => l.taskId === id)?.date ?? null
	}));
}

/** Pick Tasks for every open Slot of a Variant, never repeating a Task within it. */
export function pickForVariant(accountId: string, variantId: string): Record<string, string> {
	const slots = db
		.select()
		.from(slot)
		.where(eq(slot.variantId, variantId))
		.orderBy(asc(slot.sortOrder))
		.all();
	if (!slots.some((s) => s.fillRule)) return {};
	const pool = candidates(accountId);
	const used = new Set(slots.map((s) => s.taskId).filter((x): x is string => !!x));
	const picks: Record<string, string> = {};
	for (const s of slots) {
		if (!s.fillRule) continue;
		const id = pickTask(s.fillRule as FillRule, pool, used);
		if (id) {
			picks[s.id] = id;
			used.add(id);
		}
	}
	return picks;
}

function history(habitId: string, before: string): Done[] {
	return db
		.select({ date: occurrence.date, variantId: occurrence.variantId, status: occurrence.status })
		.from(occurrence)
		.where(and(eq(occurrence.habitId, habitId), lt(occurrence.date, before)))
		.all()
		.filter((o): o is Done => o.status === 'done' || o.status === 'skipped');
}

/**
 * Settle past Occurrences that were never acted on. A waiting rotation carries its
 * Variant over to today and a frequency target has no daily misses, so those are
 * dropped; anything else becomes missed.
 */
function settlePast(habitId: string, schedule: ScheduleForm, today: string) {
	const carriesOver =
		schedule.kind === 'frequency' ||
		(schedule.kind === 'rotation' && schedule.step === 'variant' && schedule.onMiss === 'wait');
	const stale = and(
		eq(occurrence.habitId, habitId),
		eq(occurrence.status, 'due'),
		lt(occurrence.date, today)
	);
	if (carriesOver) db.delete(occurrence).where(stale).run();
	else db.update(occurrence).set({ status: 'missed' }).where(stale).run();
}

/** Create today's Occurrence for a build habit if one is due and none exists yet. */
function ensureToday(accountId: string, habitId: string, schedule: ScheduleForm, today: string) {
	settlePast(habitId, schedule, today);
	const existing = db
		.select()
		.from(occurrence)
		.where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, today)))
		.get();
	if (existing) return existing;
	const variantId = dueOn(schedule as Schedule, history(habitId, today), today);
	if (!variantId) return null;
	return createOccurrence(accountId, habitId, variantId, today);
}

export function createOccurrence(
	accountId: string,
	habitId: string,
	variantId: string,
	date: string
) {
	const row = {
		id: randomUUID(),
		habitId,
		variantId,
		date,
		status: 'due' as const,
		picks: pickForVariant(accountId, variantId),
		notes: null,
		finishedAt: null
	};
	db.insert(occurrence).values(row).run();
	return row;
}

/** For a rotation that is resting today: the Variant you could start early. */
export function nextEarly(habitId: string, schedule: ScheduleForm, today: string) {
	if (schedule.kind !== 'rotation' || schedule.step !== 'variant') return null;
	return nextInRotation(schedule, history(habitId, today), today)?.variantId ?? null;
}

export interface TodayItem {
	habitId: string;
	name: string;
	occurrence: { id: string; status: string; variantName: string | null; slotCount: number } | null;
	streak: number;
	earlyVariant: { id: string; name: string } | null;
	multiVariant: boolean;
}

export interface BreakItem {
	habitId: string;
	name: string;
	days: number;
	longest: number;
	slippedToday: number;
}

export function loadToday(accountId: string, today: string) {
	const habits = db
		.select()
		.from(habit)
		.where(and(eq(habit.accountId, accountId), eq(habit.archived, false)))
		.orderBy(asc(habit.sortOrder), asc(habit.name))
		.all();

	const build: TodayItem[] = [];
	const resting: TodayItem[] = [];
	const breaking: BreakItem[] = [];

	for (const h of habits) {
		if (h.direction === 'break') {
			const slips = db
				.select({ date: slip.date, count: slip.count })
				.from(slip)
				.where(eq(slip.habitId, h.id))
				.all();
			const dates = slips.map((s) => s.date);
			breaking.push({
				habitId: h.id,
				name: h.name,
				days: daysSinceSlip(dates, h.startDate, today),
				longest: longestRun(dates, h.startDate, today),
				slippedToday: slips.filter((s) => s.date === today).reduce((n, s) => n + s.count, 0)
			});
			continue;
		}
		const schedule = h.schedule as ScheduleForm | null;
		if (!schedule) continue;

		const occ = ensureToday(accountId, h.id, schedule, today);
		const variants = db.select().from(variant).where(eq(variant.habitId, h.id)).all();
		const statuses = db
			.select({ status: occurrence.status })
			.from(occurrence)
			.where(eq(occurrence.habitId, h.id))
			.orderBy(asc(occurrence.date))
			.all()
			.map((o) => o.status);

		const item: TodayItem = {
			habitId: h.id,
			name: h.name,
			occurrence: occ
				? {
						id: occ.id,
						status: occ.status,
						variantName: variants.find((v) => v.id === occ.variantId)?.name ?? null,
						slotCount: occ.variantId
							? db.select({ id: slot.id }).from(slot).where(eq(slot.variantId, occ.variantId)).all()
									.length
							: 0
					}
				: null,
			streak: buildStreak(statuses),
			earlyVariant: null,
			multiVariant: variants.length > 1
		};
		if (occ) build.push(item);
		else {
			const early = nextEarly(h.id, schedule, today);
			const v = variants.find((x) => x.id === early);
			item.earlyVariant = v ? { id: v.id, name: v.name } : null;
			resting.push(item);
		}
	}
	return { build, resting, breaking };
}

/** The most recent Entries of a Task before a given Occurrence, used to prefill. */
export function lastEntries(taskId: string, beforeOccurrenceId: string) {
	const prev = db
		.select({ id: occurrence.id })
		.from(entry)
		.innerJoin(occurrence, eq(entry.occurrenceId, occurrence.id))
		.where(and(eq(entry.taskId, taskId), eq(occurrence.status, 'done')))
		.orderBy(desc(occurrence.date), desc(occurrence.finishedAt))
		.all()
		.find((o) => o.id !== beforeOccurrenceId);
	if (!prev) return [];
	return db
		.select({ values: entry.values })
		.from(entry)
		.where(and(eq(entry.occurrenceId, prev.id), eq(entry.taskId, taskId)))
		.orderBy(asc(entry.sortOrder))
		.all()
		.map((e) => e.values);
}
