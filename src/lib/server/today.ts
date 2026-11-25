// Turns Schedules into today's Occurrences, and gathers what the Today screen shows.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, lte, max, or } from 'drizzle-orm';
import { db } from './db';
import {
	craving,
	entry,
	prepTick,
	habit,
	metric,
	occurrence,
	pause,
	slip,
	slot,
	tag,
	task,
	taskTag,
	variant
} from './db/schema';
import { dueOn, historyOn, isFollow, isGroup, nextInRotation, planOn, rollupRuleOf, type Done, type ParentDue, type Schedule } from '$lib/engine/schedule';
import { followDue, parentDueFor, syncParents } from './rollup';
import { depthOf, parentsEver } from '$lib/engine/tree';
import { pickTask, type Candidate, type FillRule } from '$lib/engine/fill';
import {
	daysSinceSlip,
	describeStreak,
	longestRun,
	streak,
	type Level,
	type StreakRule
} from '$lib/engine/streak';
import { orderByCue } from '$lib/engine/stack';
import { topTriggers, type Trigger } from '$lib/engine/triggers';
import { addDays, weekStart } from '$lib/engine/dates';
import { limitOn, nextDrop, usedIn, withinStreak } from '$lib/engine/limit';
import { hitsInARow, raise, type Progression } from '$lib/engine/progression';
import { DEFAULT_TRIGGERS, type ScheduleForm } from '$lib/forms';
import { activeOptions, optionName } from '$lib/options';
import { identitiesByHabit } from './repo/identities';
import { getGroups, getSettings } from './settings';
import { dayOrder, logicalDate } from '$lib/engine/day';
import { pauseOn, type Pause } from '$lib/engine/pause';
import { carriesOver, lastTimeFor } from '$lib/engine/backfill';
import { missedDaysOver, recountFrom, scheduleOn, type EarlierSchedule, type Unlogged } from '$lib/engine/unlogged';
import { habitStats, type HabitStats } from '$lib/engine/stats';
import type { Progress } from '$lib/engine/progress';
import { finishAs, progressFor, stepsOf, verdictsFor } from './progress';
import { isTick } from '$lib/engine/groups';
import { place, slotOfPath, type Position } from '$lib/engine/parts';
import { partIdsIn, positionsOf } from './positions';

/**
 * Today's date in the user's time zone, as YYYY-MM-DD. Before `dayStart` (HH:MM)
 * it is still yesterday, so a late log counts for the day it belongs to.
 */
export function todayIn(timeZone: string | undefined, dayStart = '00:00', at = new Date()): string {
	let date: string;
	try {
		date = new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
	} catch {
		date = at.toISOString().slice(0, 10);
	}
	return logicalDate(date, timeIn(timeZone, at), dayStart);
}

/** Today for an account: its time zone (from the browser, else saved) and day start. */
export function userToday(accountId: string, tz?: string | undefined): string {
	const s = getSettings(accountId);
	return todayIn(tz || s.timeZone, s.dayStart ?? '00:00');
}

/** Every pause of an account (vacations and per-habit pauses). */
export function pausesOf(accountId: string): Pause[] {
	return db
		.select({ habitId: pause.habitId, start: pause.start, end: pause.end })
		.from(pause)
		.where(eq(pause.accountId, accountId))
		.all();
}

function pausesForHabit(accountId: string, habitId: string): Pause[] {
	return db
		.select({ habitId: pause.habitId, start: pause.start, end: pause.end })
		.from(pause)
		.where(and(eq(pause.accountId, accountId), or(isNull(pause.habitId), eq(pause.habitId, habitId))))
		.all();
}

/** The time now in the user's time zone, as HH:MM. */
export function timeIn(timeZone: string | undefined, at = new Date()): string {
	try {
		return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
	} catch {
		return at.toISOString().slice(11, 16);
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
	const { rank } = getGroups(accountId);
	const used = new Set(slots.map((s) => s.taskId).filter((x): x is string => !!x));
	const picks: Record<string, string> = {};
	for (const s of slots) {
		if (!s.fillRule) continue;
		const id = pickTask(s.fillRule as FillRule, pool, rank, used);
		if (id) {
			picks[s.id] = id;
			used.add(id);
		}
	}
	return picks;
}

/** What was done or skipped before a date, for the schedule. */
export function history(habitId: string, before: string): Done[] {
	return db
		.select({ date: occurrence.date, variantId: occurrence.variantId, status: occurrence.status, extra: occurrence.extra })
		.from(occurrence)
		.where(and(eq(occurrence.habitId, habitId), lt(occurrence.date, before)))
		.all()
		.filter((o): o is Done & { extra: boolean } => o.status === 'done' || o.status === 'skipped');
}

/** What settling needs to know about a habit. */
interface Settling {
	id: string;
	accountId: string;
	startDate: string;
	unlogged: Unlogged;
	settledThrough: string | null;
	earlierSchedules: EarlierSchedule[] | null;
}

const settlingOf = (habitId: string): Settling | undefined =>
	db
		.select({
			id: habit.id,
			accountId: habit.accountId,
			startDate: habit.startDate,
			unlogged: habit.unlogged,
			settledThrough: habit.settledThrough,
			earlierSchedules: habit.earlierSchedules
		})
		.from(habit)
		.where(eq(habit.id, habitId))
		.get();

/** The schedule a habit had on a day: an earlier one for days before an edit that applied from then on. */
export const scheduleAt = (h: { schedule: unknown; earlierSchedules: EarlierSchedule[] | null }, date: string): Schedule =>
	scheduleOn(h.schedule as Schedule, h.earlierSchedules, date);

const hasEntries = (id: string) => !!db.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, id)).get();

/** For a habit that follows its parent now or did before: what the parent had due each day. */
function followsAt(h: Pick<Settling, 'id' | 'earlierSchedules'>, schedule: unknown, today: string): ParentDue | undefined {
	const follows = isFollow(schedule as Schedule) || !!h.earlierSchedules?.some((e) => isFollow(e.schedule));
	return follows ? parentDueFor(h.id, today) : undefined;
}

/**
 * Past logs with something in them are judged by the habit's rule once their day is over: a
 * log left open is done when it counts and missed when it falls short, and so is a finished
 * one that falls short. Their values stay either way. Rows of days settled before are left.
 */
function judgeEnded(h: Settling, today: string, paused: (d: string) => boolean) {
	const rows = db
		.select({ id: occurrence.id, status: occurrence.status, date: occurrence.date })
		.from(occurrence)
		.where(
			and(
				eq(occurrence.habitId, h.id),
				lt(occurrence.date, today),
				h.settledThrough
					? or(eq(occurrence.status, 'due'), and(eq(occurrence.status, 'done'), gt(occurrence.date, h.settledThrough)))
					: inArray(occurrence.status, ['due', 'done'])
			)
		)
		.all();
	if (!rows.length) return;
	const v = verdictsFor(rows.map((o) => o.id));
	const toDone = rows.filter((o) => o.status === 'due' && v.has(o.id) && v.get(o.id) !== 'short').map((o) => o.id);
	const short = rows.filter((o) => v.get(o.id) === 'short');
	// On a paused day nothing was due, so a log that falls short counts neither way.
	const toSkipped = short.filter((o) => paused(o.date)).map((o) => o.id);
	const toMissed = short.filter((o) => !paused(o.date)).map((o) => o.id);
	if (toDone.length) db.update(occurrence).set({ status: 'done' }).where(inArray(occurrence.id, toDone)).run();
	if (toMissed.length) db.update(occurrence).set({ status: 'missed', finishedAt: null }).where(inArray(occurrence.id, toMissed)).run();
	if (toSkipped.length) db.update(occurrence).set({ status: 'skipped', finishedAt: null }).where(inArray(occurrence.id, toSkipped)).run();
}

/**
 * Settle past days. A due Occurrence that was never acted on becomes missed, and so does a
 * due day the app was never opened on (see engine/unlogged.ts), unless the habit is set to
 * ignore days you don't log: then an untouched day simply goes away. A waiting rotation and
 * a frequency target carry over to the next day, so their leftover due rows go away, and
 * their misses are counted per missed session instead.
 */
function settlePast(h: Settling, schedule: ScheduleForm, today: string, pauses: Pause[]) {
	// A group's days are written from the habits inside it (see rollup.ts), never settled here.
	if (isGroup(schedule)) return;
	const habitId = h.id;
	const pd = followsAt(h, schedule, today);
	judgeEnded(h, today, (d) => !!pauseOn(pauses, habitId, d));
	// Due days that fell in a pause simply go away: they were never due.
	if (pauses.length) {
		const old = db
			.select({ id: occurrence.id, date: occurrence.date })
			.from(occurrence)
			.where(and(eq(occurrence.habitId, habitId), eq(occurrence.status, 'due'), lt(occurrence.date, today)))
			.all()
			.filter((o) => pauseOn(pauses, habitId, o.date) && !hasEntries(o.id));
		if (old.length) db.delete(occurrence).where(inArray(occurrence.id, old.map((o) => o.id))).run();
	}
	const stale = and(
		eq(occurrence.habitId, habitId),
		eq(occurrence.status, 'due'),
		lt(occurrence.date, today)
	);
	// Logs with something in them were judged above, so what is still due here is untouched.
	// A day whose plan carries over (a weekly target, a waiting rotation) was never missed on
	// its own: it goes away. Each day by the plan it had, since phases and edits change it.
	const carried = db
		.select({ id: occurrence.id, date: occurrence.date })
		.from(occurrence)
		.where(stale)
		.all()
		.filter((o) => carriesOver(scheduleOn(schedule as Schedule, h.earlierSchedules, o.date), o.date))
		.map((o) => o.id);
	if (carried.length) db.delete(occurrence).where(inArray(occurrence.id, carried)).run();

	// A day the schedule never planned (a past day opened to log by hand, a rotation
	// started early) that was left without a log goes away instead of counting as a miss.
	// With unlogged days ignored, so does any due day left untouched (a note is kept).
	const gone = db
		.select({ id: occurrence.id, date: occurrence.date, notes: occurrence.notes })
		.from(occurrence)
		.where(stale)
		.all()
		.filter(
			(o) =>
				!hasEntries(o.id) &&
				(h.unlogged === 'ignore' ? !o.notes : !dueOn(scheduleOn(schedule as Schedule, h.earlierSchedules, o.date), history(habitId, o.date), o.date, pd))
		);
	if (gone.length) db.delete(occurrence).where(inArray(occurrence.id, gone.map((o) => o.id))).run();
	db.update(occurrence).set({ status: 'missed' }).where(stale).run();
	if (pd) markExtras(h, schedule, today, pauses, pd);
	const yesterday = addDays(today, -1);
	if (h.unlogged === 'missed') fillMisses(h, schedule, yesterday, pauses, pd);
	if (!h.settledThrough || h.settledThrough < yesterday) {
		db.update(habit).set({ settledThrough: yesterday }).where(eq(habit.id, habitId)).run();
		// Its days from here on are settled now: the habits that follow it count theirs again from here.
		recountFollowers(habitId, h.settledThrough ? addDays(h.settledThrough, 1) : null, today);
	}
}

/**
 * For a habit that follows its parent: a day it was logged on counts as planned when the parent
 * had it due that day (it may have been logged before the parent's day was), and a done day
 * the parent no longer has due is an extra. Days of an earlier plan of its own, and paused
 * days, are left as they are.
 */
function markExtras(h: Settling, schedule: ScheduleForm, today: string, pauses: Pause[], pd: ParentDue) {
	const rows = db
		.select({ id: occurrence.id, date: occurrence.date, status: occurrence.status, extra: occurrence.extra })
		.from(occurrence)
		.where(and(eq(occurrence.habitId, h.id), lte(occurrence.date, today)))
		.all();
	const planned: string[] = [];
	const extras: string[] = [];
	for (const r of rows) {
		const s = scheduleOn(schedule as Schedule, h.earlierSchedules, r.date);
		if (!isFollow(s) || pauseOn(pauses, h.id, r.date)) continue;
		const due = !!dueOn(s, [], r.date, pd);
		if (r.extra && due) planned.push(r.id);
		else if (!r.extra && !due && r.status === 'done') extras.push(r.id);
	}
	if (planned.length) db.update(occurrence).set({ extra: false }).where(inArray(occurrence.id, planned)).run();
	if (extras.length) db.update(occurrence).set({ extra: true }).where(inArray(occurrence.id, extras)).run();
}

/** Habits that follow `parentId` now, or followed it on days they keep. */
function followersOf(parentId: string) {
	return db
		.select({
			id: habit.id,
			schedule: habit.schedule,
			earlierSchedules: habit.earlierSchedules,
			parentId: habit.parentId,
			earlierParents: habit.earlierParents,
			settledThrough: habit.settledThrough
		})
		.from(habit)
		.where(and(eq(habit.direction, 'build'), or(eq(habit.parentId, parentId), like(habit.earlierParents, `%"${parentId}"%`))))
		.all()
		.filter(
			(f) =>
				parentsEver(f.parentId, f.earlierParents).includes(parentId) &&
				(isFollow(f.schedule as Schedule | null) || !!f.earlierSchedules?.some((e) => isFollow(e.schedule)))
		);
}

/**
 * A habit's days from `from` on (all of them when null) were settled again, or for the first
 * time: the habits that follow it take their days from its days, so they count theirs again
 * from the same day.
 * Misses written for days it may no longer have go, and the rest are written again when they
 * settle next, which is always after it (parents first). Misses with something logged or a
 * note in them stay. A habit following one of these is counted again when it settles in turn.
 */
function recountFollowers(parentId: string, from: string | null, today: string) {
	for (const f of followersOf(parentId)) {
		const ids = db
			.select({ id: occurrence.id })
			.from(occurrence)
			.where(and(eq(occurrence.habitId, f.id), eq(occurrence.status, 'missed'), isNull(occurrence.notes), from ? gte(occurrence.date, from) : undefined, lt(occurrence.date, today)))
			.all()
			.map((o) => o.id)
			.filter((id) => !hasEntries(id));
		if (ids.length) db.delete(occurrence).where(inArray(occurrence.id, ids)).run();
		if (f.settledThrough && (!from || f.settledThrough >= from)) db.update(habit).set({ settledThrough: from ? addDays(from, -1) : null }).where(eq(habit.id, f.id)).run();
	}
}

/** Write a miss for every due day nobody logged since the habit was last settled. */
function fillMisses(h: Settling, schedule: ScheduleForm, yesterday: string, pauses: Pause[], pd?: ParentDue) {
	const from = h.settledThrough ? addDays(h.settledThrough, 1) : h.startDate;
	if (from > yesterday) return;
	const rows = db
		.select({ date: occurrence.date, status: occurrence.status, variantId: occurrence.variantId, extra: occurrence.extra })
		.from(occurrence)
		.where(eq(occurrence.habitId, h.id))
		.all();
	const misses = missedDaysOver(schedule as Schedule, h.earlierSchedules, rows, h.startDate, from, yesterday, (d) => !!pauseOn(pauses, h.id, d), pd);
	if (!misses.length) return;
	const variants = new Set(db.select({ id: variant.id }).from(variant).where(eq(variant.habitId, h.id)).all().map((v) => v.id));
	// Auto-filled Slots get their Tasks, so a missed day can be opened and logged like any other.
	const picksOf = new Map<string, Record<string, string>>();
	const picksFor = (variantId: string) => {
		if (!picksOf.has(variantId)) picksOf.set(variantId, pickForVariant(h.accountId, variantId));
		return picksOf.get(variantId)!;
	};
	db.transaction((tx) => {
		for (const m of misses) {
			const variantId = m.variantId && variants.has(m.variantId) ? m.variantId : null;
			tx.insert(occurrence)
				.values({
					id: randomUUID(),
					habitId: h.id,
					variantId,
					date: m.date,
					status: 'missed',
					picks: variantId ? picksFor(variantId) : null,
					notes: null,
					finishedAt: null,
					level: null
				})
				.run();
		}
	});
}

/**
 * Auto-filled Slots of a log that have no Task picked yet get one (misses written before
 * picks were, a Slot added later). Returns the log's picks.
 */
export function ensurePicks(occurrenceId: string): Record<string, string> | null {
	const o = db
		.select({ id: occurrence.id, variantId: occurrence.variantId, picks: occurrence.picks, accountId: habit.accountId })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(eq(occurrence.id, occurrenceId))
		.get();
	if (!o?.variantId) return o?.picks ?? null;
	const open = db
		.select({ id: slot.id })
		.from(slot)
		.where(and(eq(slot.variantId, o.variantId), isNotNull(slot.fillRule)))
		.all()
		.filter((x) => !o.picks?.[x.id]);
	if (!open.length) return o.picks;
	const fresh = pickForVariant(o.accountId, o.variantId);
	const used = new Set(Object.values(o.picks ?? {}));
	const picks = { ...(o.picks ?? {}) };
	for (const x of open) if (fresh[x.id] && !used.has(fresh[x.id])) picks[x.id] = fresh[x.id];
	if (Object.keys(picks).length !== Object.keys(o.picks ?? {}).length)
		db.update(occurrence).set({ picks }).where(eq(occurrence.id, o.id)).run();
	return picks;
}

/**
 * Settle a habit's past days without creating today's Occurrence. A habit in a tree settles
 * with the whole tree, parents first, since the days of a habit that follows its parent come
 * from the parent's days.
 */
export function settle(accountId: string, habitId: string, schedule: ScheduleForm, today: string) {
	if (isGroup(schedule)) return settleTree(accountId, today, false);
	if (inTree(habitId)) settleTree(accountId, today, false);
	// An archived habit isn't in the tree's walk: it settles on its own.
	const h = settlingOf(habitId);
	if (h && (!h.settledThrough || h.settledThrough < addDays(today, -1))) settlePast(h, schedule, today, pausesForHabit(accountId, habitId));
}

/**
 * Does this habit sit inside another, or hold habits inside it, now or on days it keeps from
 * before a move? Then it settles with its tree, and its parents are counted again.
 */
function inTree(habitId: string): boolean {
	const h = db.select({ parentId: habit.parentId, earlierParents: habit.earlierParents }).from(habit).where(eq(habit.id, habitId)).get();
	if (h && parentsEver(h.parentId, h.earlierParents).length) return true;
	return !!db
		.select({ id: habit.id })
		.from(habit)
		.where(or(eq(habit.parentId, habitId), like(habit.earlierParents, `%"${habitId}"%`)))
		.get();
}

/**
 * A past day changed: count the misses of a schedule that carries over again from where they
 * could have changed (see recountFrom), and settle. Misses with nothing logged and no note
 * in them are the counted ones; anything else stays.
 */
export function recount(accountId: string, habitId: string, schedule: ScheduleForm, date: string, today: string) {
	if (isGroup(schedule)) return settleTree(accountId, today, false);
	const h = settlingOf(habitId);
	if (!h) return;
	const from = recountFrom(scheduleOn(schedule as Schedule, h.earlierSchedules, date), date);
	if (from && h.unlogged === 'missed') {
		const ids = db
			.select({ id: occurrence.id })
			.from(occurrence)
			.where(and(eq(occurrence.habitId, habitId), eq(occurrence.status, 'missed'), isNull(occurrence.notes), gte(occurrence.date, from), lt(occurrence.date, today)))
			.all()
			.map((o) => o.id)
			.filter((id) => !db.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, id)).get());
		if (ids.length) db.delete(occurrence).where(inArray(occurrence.id, ids)).run();
	}
	const back = addDays(from ?? date, -1);
	if (h.settledThrough && h.settledThrough > back) {
		db.update(habit).set({ settledThrough: back }).where(eq(habit.id, habitId)).run();
		h.settledThrough = back;
	}
	// In a tree, parents settle first and the habits that follow this one after it.
	if (inTree(habitId)) settleTree(accountId, today, false);
	const now = settlingOf(habitId);
	if (now && (!now.settledThrough || now.settledThrough < addDays(today, -1))) settlePast(now, schedule, today, pausesForHabit(accountId, habitId));
}

/**
 * Once, after the partial-day rule came in: past days with something logged that were
 * settled as missed are judged again, so a day that reached its Minimum (or had anything
 * logged, for a habit with no Minimum) is done. Days already done are left as they were.
 * Returns how many days changed.
 */
export function restorePartialDays(): number {
	const rows = db
		.select({
			id: occurrence.id,
			date: occurrence.date,
			habitId: occurrence.habitId,
			accountId: habit.accountId,
			schedule: habit.schedule,
			settledThrough: habit.settledThrough
		})
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.innerJoin(entry, eq(entry.occurrenceId, occurrence.id))
		.where(and(eq(occurrence.status, 'missed'), eq(habit.direction, 'build'), isNotNull(habit.settledThrough)))
		.groupBy(occurrence.id)
		.all()
		.filter((r) => r.date <= r.settledThrough!);
	if (!rows.length) return 0;
	const v = verdictsFor(rows.map((r) => r.id));
	const back = rows.filter((r) => v.has(r.id) && v.get(r.id) !== 'short');
	if (!back.length) return 0;
	db.update(occurrence).set({ status: 'done' }).where(inArray(occurrence.id, back.map((r) => r.id))).run();
	// A weekly target or a waiting rotation counts its misses again from the earliest such day.
	const first = new Map<string, (typeof back)[number]>();
	for (const r of back) if (!first.has(r.habitId) || r.date < first.get(r.habitId)!.date) first.set(r.habitId, r);
	for (const r of first.values())
		if (r.schedule && carriesOver(r.schedule as Schedule, r.date))
			recount(r.accountId, r.habitId, r.schedule as ScheduleForm, r.date, addDays(r.settledThrough!, 1));
	return back.length;
}

/**
 * A habit comes back from the archive: the days it spent there were not due, so counting
 * starts again from today. (It was settled when it was archived.)
 */
export function unarchived(habitId: string, today: string) {
	const yesterday = addDays(today, -1);
	const h = settlingOf(habitId);
	if (h && (!h.settledThrough || h.settledThrough < yesterday))
		db.update(habit).set({ settledThrough: yesterday }).where(eq(habit.id, habitId)).run();
}

/**
 * A pause (or a vacation, for every habit) was added or taken away: misses written for its
 * days go, and the days are counted again with the pauses as they are now. Misses with
 * something logged or a note in them stay.
 */
export function repaused(accountId: string, habitId: string | null, start: string, end: string, today: string) {
	// A habit that follows the paused one (or follows one that does) has no days while it is
	// paused either. The paused habit is counted first, then those following it, level by level.
	const all = db
		.select({ id: habit.id, schedule: habit.schedule, parentId: habit.parentId })
		.from(habit)
		.where(and(eq(habit.accountId, accountId), eq(habit.direction, 'build')))
		.all();
	let rows = all;
	if (habitId) {
		rows = all.filter((r) => r.id === habitId);
		for (let i = 0; i < rows.length && i < all.length; i++)
			rows.push(...all.filter((r) => r.parentId === rows[i].id && isFollow(r.schedule as Schedule | null)));
	}
	const last = end < today ? end : addDays(today, -1);
	for (const r of rows) {
		if (!r.schedule) continue;
		if (start <= last) {
			const ids = db
				.select({ id: occurrence.id })
				.from(occurrence)
				.where(and(eq(occurrence.habitId, r.id), eq(occurrence.status, 'missed'), isNull(occurrence.notes), gte(occurrence.date, start), lte(occurrence.date, last)))
				.all()
				.map((o) => o.id)
				.filter((id) => !db.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, id)).get());
			if (ids.length) db.delete(occurrence).where(inArray(occurrence.id, ids)).run();
		}
		recount(accountId, r.id, r.schedule as ScheduleForm, start, today);
	}
}

/** Settle every build habit of an account, so pages that read the past (Stats, the chain) see every miss. */
export function settleAll(accountId: string, today: string) {
	settleTree(accountId, today, false);
}

/** The account's build habits, each after the habit it sits in, so a routine settles before the habits that follow it. */
function treeOrder(accountId: string) {
	const rows = db
		.select({ id: habit.id, schedule: habit.schedule, parentId: habit.parentId, archived: habit.archived })
		.from(habit)
		.where(and(eq(habit.accountId, accountId), eq(habit.direction, 'build')))
		.all();
	const depth = new Map(rows.map((r) => [r.id, depthOf(rows, r.id)]));
	return rows.filter((r) => !r.archived).sort((a, b) => depth.get(a.id)! - depth.get(b.id)!);
}

/**
 * Settle every build habit, parents before the habits inside them, then write every group's
 * and routine's days from them. With `withToday`, today's Occurrences are made first, so the
 * parents' today is counted too.
 */
function settleTree(accountId: string, today: string, withToday: boolean) {
	for (const r of treeOrder(accountId)) {
		if (!r.schedule || isGroup(r.schedule as Schedule)) continue;
		if (withToday) ensureOwnToday(accountId, r.id, r.schedule as ScheduleForm, today);
		else {
			const h = settlingOf(r.id);
			if (h) settlePast(h, r.schedule as ScheduleForm, today, pausesForHabit(accountId, r.id));
		}
	}
	syncTree(accountId, today);
}

/** How deep routines are being counted again from syncTree, so a change can't go round forever. */
let rejudging = 0;

/**
 * Write every group's and routine's days from the habits inside them (see rollup.ts). A past
 * day of a routine that became done (or stopped being done) because of the habits inside it
 * moves a plan that carries over, such as a waiting rotation: its later days are counted
 * again from that day, and so are the habits that follow it.
 */
export function syncTree(accountId: string, today: string) {
	const flipped = syncParents(accountId, today, pausesOf(accountId));
	if (!flipped.length || rejudging >= 3) return;
	rejudging++;
	try {
		const first = new Map<string, string>();
		for (const f of flipped) if (!first.has(f.habitId) || f.date < first.get(f.habitId)!) first.set(f.habitId, f.date);
		for (const [habitId, date] of first) {
			const r = db.select({ schedule: habit.schedule, earlierSchedules: habit.earlierSchedules }).from(habit).where(eq(habit.id, habitId)).get();
			if (r?.schedule && carriesOver(scheduleOn(r.schedule as Schedule, r.earlierSchedules, date), date))
				recount(accountId, habitId, r.schedule as ScheduleForm, date, today);
		}
	} finally {
		rejudging--;
	}
}

/** A group's Occurrence today, as last written by syncParents: none on a paused day still open. */
function groupToday(accountId: string, habitId: string, today: string) {
	const existing = db
		.select()
		.from(occurrence)
		.where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, today)))
		.get();
	if (!existing) return null;
	return existing.status === 'due' && pauseOn(pausesForHabit(accountId, habitId), habitId, today) ? null : existing;
}

/**
 * Create today's Occurrence for a build habit if one is due and none exists yet. A group's
 * comes from the habits inside it: they are brought up to date, and the group's is returned.
 * So is a routine's, once the habits inside it have counted.
 */
export function ensureToday(accountId: string, habitId: string, schedule: ScheduleForm, today: string) {
	if (isGroup(schedule)) {
		settleTree(accountId, today, true);
		return groupToday(accountId, habitId, today);
	}
	const own = ensureOwnToday(accountId, habitId, schedule, today);
	if (!inTree(habitId)) return own;
	settleTree(accountId, today, true);
	return db
		.select()
		.from(occurrence)
		.where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, today)))
		.get() ?? null;
}

/** Habits whose today is being made, so a loop in old parent links can't recurse forever. */
const ensuring = new Set<string>();

/**
 * Today's Occurrence from the habit's own schedule, without counting any parent again. A habit
 * that follows its parent needs the parent's today first.
 */
function ensureOwnToday(accountId: string, habitId: string, schedule: ScheduleForm, today: string) {
	if (isFollow(schedule)) {
		const parent = parentRow(habitId);
		if (parent?.schedule && !isGroup(parent.schedule as Schedule) && !ensuring.has(parent.id)) {
			ensuring.add(parent.id);
			try {
				ensureOwnToday(accountId, parent.id, parent.schedule as ScheduleForm, today);
			} finally {
				ensuring.delete(parent.id);
			}
		}
	}
	const pauses = pausesForHabit(accountId, habitId);
	const h = settlingOf(habitId);
	if (!h) return null;
	settlePast(h, schedule, today, pauses);
	// A habit set to start later has nothing due yet.
	if (today < h.startDate) return null;
	const existing = db
		.select()
		.from(occurrence)
		.where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, today)))
		.get();
	const paused = !!pauseOn(pauses, habitId, today);
	if (existing) return paused && existing.status === 'due' ? null : isFollow(schedule) ? replanFollower(accountId, existing, schedule, today) : existing;
	if (paused) return null;
	const variantId = dueOn(schedule as Schedule, history(habitId, today), today, followDue(habitId, schedule, today));
	if (!variantId) return null;
	return createOccurrence(accountId, habitId, variantId, today);
}

/**
 * A habit that follows its routine takes today from the routine's today, which can change
 * after it was planned: a waiting rotation moved on, the routine's schedule was edited. While
 * nothing is in it yet (no value, no note, not logged early by hand), today is planned again:
 * with the Variant the routine's Variant now brings up, or gone when the routine no longer has
 * it due. Anything with something in it stays as it was.
 */
function replanFollower(accountId: string, occ: typeof occurrence.$inferSelect, schedule: ScheduleForm, today: string) {
	if (occ.status !== 'due' || occ.extra || occ.notes || hasEntries(occ.id)) return occ;
	const planned = dueOn(schedule as Schedule, [], today, followDue(occ.habitId, schedule, today));
	if (planned === occ.variantId) return occ;
	if (!planned) {
		db.delete(occurrence).where(eq(occurrence.id, occ.id)).run();
		return null;
	}
	const picks = pickForVariant(accountId, planned);
	db.update(occurrence).set({ variantId: planned, picks }).where(eq(occurrence.id, occ.id)).run();
	return { ...occ, variantId: planned, picks };
}

/** The habit this one sits in. */
const parentRow = (habitId: string) => {
	const c = db.select({ parentId: habit.parentId }).from(habit).where(eq(habit.id, habitId)).get();
	return c?.parentId ? db.select({ id: habit.id, schedule: habit.schedule }).from(habit).where(eq(habit.id, c.parentId)).get() : undefined;
};

export function createOccurrence(
	accountId: string,
	habitId: string,
	variantId: string,
	date: string,
	/** Logged on a day nothing was due. */
	extra = false
) {
	const row = {
		id: randomUUID(),
		habitId,
		variantId,
		date,
		status: 'due' as const,
		picks: pickForVariant(accountId, variantId),
		notes: null,
		finishedAt: null,
		level: null,
		extra,
		goals: null,
		kept: null,
		rollup: null
	};
	db.insert(occurrence).values(row).run();
	return row;
}

/** For a rotation that is resting today: the Variant you could start early. */
export function nextEarly(habitId: string, schedule: ScheduleForm, today: string) {
	const plan = planOn(schedule as Schedule, today);
	if (plan.kind !== 'rotation' || plan.step !== 'variant') return null;
	return nextInRotation(plan, historyOn(schedule as Schedule, history(habitId, today), today), today)?.variantId ?? null;
}

export interface TodayItem {
	habitId: string;
	name: string;
	occurrence: {
		id: string;
		status: string;
		variantName: string | null;
		slotCount: number;
		level: Level | null;
	} | null;
	streak: string;
	/** Never miss twice: the last one was missed. */
	atRisk: boolean;
	earlyVariant: { id: string; name: string } | null;
	multiVariant: boolean;
	cue: { time: string | null; place: string | null; after: string | null; range: string | null };
	afterHabitId: string | null;
	/** Stacked after a Habit that is done today, and still due. */
	upNext: boolean;
	levels: { minimum: string; target: string; stretch: string } | null;
	quickDone: boolean;
	identities: string[];
	reframe: string | null;
	bundle: { reward: string; strict: boolean } | null;
	reward: { celebrate: boolean; message: string; jar: { total: number; unit: string; goal: string } | null } | null;
	/** Targets have been hit this many times in a row; suggest raising them. */
	progression: { hits: number; by: number; unit: 'percent' | 'steps'; changes: string[] } | null;
	/** Started on the log screen and saved, not finished yet. */
	inProgress: boolean;
	/** A finished log exists to copy with "Same as last time". */
	canRepeat: boolean;
	areaId: string | null;
	/** Paused until this date (inclusive), for habits in a pause. */
	pausedUntil: string | null;
	stats: HabitStats;
	/** How far along today's log is: "3 of 6 glasses" (with +1 on Today) or "2 of 4 steps". */
	progress: Progress | null;
	/** The group this habit sits in, when that group is active. */
	parentId: string | null;
	/**
	 * For a group, or a routine on a day the habits inside it count: its rule, today's count,
	 * and the habits inside it (shown on Today or not). A routine can be marked done or skipped
	 * as a whole, which marks the habits inside.
	 */
	group: { routine: boolean; target: number | null; minimum: number | null; done: number; total: number; kids: string[] } | null;
}

export interface PrepItem {
	habitId: string;
	name: string;
	/** The date of the Occurrence this prepares for. */
	date: string;
	items: { item: string; done: boolean }[];
}

export interface BreakItem {
	habitId: string;
	name: string;
	/** The earliest date a slip can be logged for. */
	startDate: string;
	days: number;
	longest: number;
	slippedToday: number;
	ifThen: { when: string; then: string; habit: string | null } | null;
	/** Feelings a slip can be logged with: the form sends the id. */
	triggers: { id: string; name: string }[];
	places: string[];
	top: Trigger[];
	resistedThisWeek: number;
	identities: string[];
	reframe: string | null;
	cost: { unit: string; month: number; saved: number | null } | null;
	/** Reduce mode: used and allowed in the current day or week. */
	limit: {
		used: number;
		max: number;
		period: 'day' | 'week';
		/** When a taper lowers the limit next, and to what. */
		next: { date: string; max: number } | null;
	} | null;
	areaId: string | null;
}

export function loadToday(accountId: string, today: string) {
	const habits = db
		.select()
		.from(habit)
		.where(and(eq(habit.accountId, accountId), eq(habit.archived, false)))
		.orderBy(asc(habit.sortOrder), asc(habit.name))
		.all();

	let build: TodayItem[] = [];
	const todayRows: Parameters<typeof progressFor>[0] = [];
	const resting: TodayItem[] = [];
	const paused: TodayItem[] = [];
	const breaking: BreakItem[] = [];
	const idents = identitiesByHabit(accountId);
	const settings = getSettings(accountId);
	const dayStart = settings.dayStart ?? '00:00';
	const rangeStart = new Map(settings.ranges.map((r) => [r.name, r.start]));
	const allPauses = pausesOf(accountId);
	// Habits first, then the groups they sit in: a group's day is counted from theirs.
	const groupIds = new Set(habits.filter((h) => h.direction === 'build' && isGroup(h.schedule as Schedule | null)).map((h) => h.id));
	// A routine: a habit with its own schedule and habits inside it. It is judged from them too.
	const hasKids = new Set(habits.filter((h) => h.direction === 'build' && h.parentId).map((h) => h.parentId!));
	const routineIds = new Set(
		habits.filter((h) => h.direction === 'build' && h.schedule && hasKids.has(h.id) && !isGroup(h.schedule as Schedule)).map((h) => h.id)
	);
	const todayOf = new Map<string, ReturnType<typeof ensureToday>>();
	for (const h of habits)
		if (h.direction === 'build' && h.schedule && !groupIds.has(h.id))
			todayOf.set(h.id, ensureOwnToday(accountId, h.id, h.schedule as ScheduleForm, today));
	if (groupIds.size || routineIds.size) {
		syncTree(accountId, today);
		for (const id of groupIds) todayOf.set(id, groupToday(accountId, id, today));
		// What the habits inside did today is in the routine's day now.
		for (const id of routineIds) if (todayOf.get(id)) todayOf.set(id, db.select().from(occurrence).where(eq(occurrence.id, todayOf.get(id)!.id)).get() ?? null);
	}
	const isParent = (id: string | null): id is string => !!id && (groupIds.has(id) || routineIds.has(id));
	const kidsOf = new Map<string, string[]>();
	for (const h of habits) if (isParent(h.parentId)) kidsOf.set(h.parentId, [...(kidsOf.get(h.parentId) ?? []), h.id]);

	for (const h of habits) {
		if (h.direction === 'break') {
			const slips = db
				.select({
					date: slip.date,
					count: slip.count,
					time: slip.time,
					place: slip.place,
					feeling: slip.feeling,
					withWhom: slip.withWhom
				})
				.from(slip)
				.where(eq(slip.habitId, h.id))
				.all();
			const dates = slips.map((s) => s.date);
			const monday = weekStart(today);
			breaking.push({
				habitId: h.id,
				name: h.name,
				startDate: h.startDate,
				days: h.limit
					? withinStreak(h.limit, slips, h.startDate, today)
					: daysSinceSlip(dates, h.startDate, today),
				longest: longestRun(dates, h.startDate, today),
				slippedToday: slips.filter((s) => s.date === today).reduce((n, s) => n + s.count, 0),
				ifThen: h.ifThen
					? {
							when: h.ifThen.when,
							then: h.ifThen.then,
							habit: habits.find((x) => x.id === h.ifThen?.habitId)?.name ?? null
						}
					: null,
				triggers: activeOptions(h.triggers ?? DEFAULT_TRIGGERS).map(({ id, name }) => ({ id, name })),
				places: [...new Set(slips.map((s) => s.place).filter((p): p is string => !!p))],
				// Slips store the feeling's id: counted by its name now, so a renamed feeling keeps its slips.
				top: topTriggers(slips.map((s) => ({ ...s, feeling: optionName(h.triggers ?? DEFAULT_TRIGGERS, s.feeling) }))),
				resistedThisWeek: db
					.select({ date: craving.date })
					.from(craving)
					.where(eq(craving.habitId, h.id))
					.all()
					.filter((c) => c.date >= monday && c.date <= today).length,
				identities: idents.get(h.id) ?? [],
				reframe: h.reframe,
				cost: h.cost
					? {
							unit: h.cost.unit,
							month:
								slips
									.filter((s) => s.date.slice(0, 7) === today.slice(0, 7))
									.reduce((n, s) => n + s.count, 0) * h.cost.amount,
							// Saved = what the old daily rate would have cost since the start, minus what
							// slips cost. Only finished days count, so today doesn't count before it ends.
							saved: h.cost.perDay
								? Math.max(
										0,
										(daysBetweenInclusive(h.startDate, addDays(today, -1)) * h.cost.perDay -
											slips
												.filter((s) => s.date >= h.startDate && s.date < today)
												.reduce((n, s) => n + s.count, 0)) *
											h.cost.amount
									)
								: null
						}
					: null,
				limit: h.limit
					? {
							used: usedIn(h.limit, slips, today),
							max: limitOn(h.limit, today),
							period: h.limit.period,
							next: nextDrop(h.limit, today)
						}
					: null,
				areaId: h.areaId
			});
			continue;
		}
		const schedule = h.schedule as ScheduleForm | null;
		if (!schedule) continue;

		const occ = todayOf.get(h.id) ?? null;
		// A routine shows as a parent on days the habits inside it count.
		const group = isGroup(schedule) ? schedule : routineIds.has(h.id) && occ?.rollup ? rollupRuleOf(schedule as Schedule) : null;
		const everyVariant = db.select().from(variant).where(eq(variant.habitId, h.id)).all();
		const variants = everyVariant.filter((v) => !v.archived);
		const marks = db
			.select({ date: occurrence.date, status: occurrence.status, level: occurrence.level })
			.from(occurrence)
			.where(eq(occurrence.habitId, h.id))
			.orderBy(asc(occurrence.date))
			.all();
		const rule = h.streakRule as StreakRule;
		const st = streak(marks, rule, { minimumCounts: h.minimumCounts, today });
		const anchor = h.cue?.afterHabitId ? habits.find((x) => x.id === h.cue?.afterHabitId) : null;

		const item: TodayItem = {
			habitId: h.id,
			name: h.name,
			occurrence: occ
				? {
						id: occ.id,
						status: occ.status,
						variantName: everyVariant.find((v) => v.id === occ.variantId)?.name ?? null,
						slotCount: occ.variantId
							? db.select({ id: slot.id }).from(slot).where(eq(slot.variantId, occ.variantId)).all()
									.length
							: 0,
						level: occ.level ?? null
					}
				: null,
			streak: describeStreak(st, rule),
			atRisk: st.atRisk,
			earlyVariant: null,
			multiVariant: variants.length > 1,
			cue: {
				time: h.cue?.time ?? null,
				place: h.cue?.place ?? null,
				after: anchor?.name ?? h.cue?.afterText ?? null,
				range: h.cue?.range ?? null
			},
			afterHabitId: anchor?.id ?? null,
			upNext: false,
			levels: h.levels?.enabled
				? { minimum: h.levels.minimum, target: h.levels.target, stretch: h.levels.stretch }
				: null,
			quickDone: h.quickDone,
			identities: idents.get(h.id) ?? [],
			reframe: h.reframe,
			bundle: h.bundle?.reward ? h.bundle : null,
			reward:
				h.reward && (h.reward.celebrate || h.reward.jar)
					? {
							celebrate: h.reward.celebrate,
							message: h.reward.message,
							jar: h.reward.jar
								? {
										total:
											Math.round(marks.filter((m) => m.status === 'done').length * h.reward.jar.amount * 100) /
											100,
										unit: h.reward.jar.unit,
										goal: h.reward.jar.goal
									}
								: null
						}
					: null,
			progression: progressionFor(h.progression, marks, h.progressionFrom, variants.map((v) => v.id)),
			inProgress:
				!!occ &&
				occ.status === 'due' &&
				!!db.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, occ.id)).get(),
			canRepeat: !!db
				.select({ id: entry.id })
				.from(entry)
				.innerJoin(occurrence, eq(entry.occurrenceId, occurrence.id))
				.where(and(eq(occurrence.habitId, h.id), eq(occurrence.status, 'done')))
				.get(),
			areaId: h.areaId,
			pausedUntil: pauseOn(allPauses, h.id, today)?.end ?? null,
			stats: habitStats(marks, today),
			progress: null,
			parentId: isParent(h.parentId) ? h.parentId : null,
			group: group
				? {
						routine: routineIds.has(h.id),
						target: group.target,
						minimum: group.minimum,
						done: occ?.rollup?.done ?? 0,
						total: occ?.rollup?.total ?? 0,
						kids: kidsOf.get(h.id) ?? []
					}
				: null
		};
		if (occ) {
			build.push(item);
			todayRows.push(occ);
		}
		else if (item.pausedUntil) paused.push(item);
		else {
			const early = nextEarly(h.id, schedule, today);
			const v = variants.find((x) => x.id === early);
			item.earlyVariant = v ? { id: v.id, name: v.name } : null;
			resting.push(item);
		}
	}

	// Cue times first, in the order the day is lived, each stacked habit right after its anchor.
	// A cue that names only a part of the day sorts at that part's start.
	const sortKey = (b: TodayItem) => {
		const t = b.cue.time ?? (b.cue.range ? rangeStart.get(b.cue.range) : null);
		return t ? String(dayOrder(t, dayStart)).padStart(4, '0') : null;
	};
	const progress = progressFor(todayRows);
	for (const b of build) b.progress = (b.occurrence && progress.get(b.occurrence.id)) || null;
	build = orderByCue(build.map((b) => ({ ...b, id: b.habitId, time: sortKey(b), afterId: b.afterHabitId })));
	const onToday = new Set(build.map((b) => b.habitId));
	for (const b of build) if (b.afterHabitId && !onToday.has(b.afterHabitId)) b.afterHabitId = null;
	const doneToday = new Set(build.filter((b) => b.occurrence?.status === 'done').map((b) => b.habitId));
	for (const b of build)
		b.upNext = !!b.afterHabitId && doneToday.has(b.afterHabitId) && b.occurrence?.status === 'due';
	return { build, resting, paused, breaking, week: weekStrip(accountId, today) };
}

/** Done and scheduled per day since Monday, for the week strip on Today. */
export function weekStrip(accountId: string, today: string) {
	const monday = weekStart(today);
	const rows = db
		.select({ date: occurrence.date, status: occurrence.status })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		// A group's day is already counted in the habits inside it.
		.where(and(eq(habit.accountId, accountId), isNull(occurrence.rollup), gte(occurrence.date, monday), lte(occurrence.date, addDays(monday, 6))))
		.all();
	return Array.from({ length: 7 }, (_, i) => {
		const date = addDays(monday, i);
		const day = rows.filter((r) => r.date === date && r.status !== 'skipped');
		return { date, done: day.filter((r) => r.status === 'done').length, of: day.length };
	});
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Entries that log a Slot's targets at a level (falling back to Target). */
function targetEntries(
	tx: Tx,
	s: Pick<Position, 'sets' | 'targets' | 'minTargets' | 'stretchTargets'>,
	taskId: string,
	level: Level | null
): Record<string, unknown>[] {
	const targets = {
		...(s.targets ?? {}),
		...((level === 'minimum' ? s.minTargets : level === 'stretch' ? s.stretchTargets : null) ?? {})
	};
	const metrics = tx.select().from(metric).where(and(eq(metric.taskId, taskId), eq(metric.archived, false))).all();
	const repeating = metrics.filter((m) => m.repeats && targets[m.id] !== undefined);
	const single = metrics.filter((m) => !m.repeats && targets[m.id] !== undefined);
	const sets = repeating.length ? Math.max(1, s.sets ?? 1) : 0;
	const out: Record<string, unknown>[] = [];
	for (let i = 0; i < sets; i++) out.push(Object.fromEntries(repeating.map((m) => [m.id, targets[m.id]])));
	if (single.length) out.push({ ...Object.fromEntries(single.map((m) => [m.id, targets[m.id]])), _summary: true });
	return out;
}

function slotsOf(occ: typeof occurrence.$inferSelect) {
	const slots = occ.variantId
		? db.select().from(slot).where(eq(slot.variantId, occ.variantId)).orderBy(asc(slot.sortOrder)).all()
		: [];
	const picks = occ.picks ?? {};
	return slots.map((s) => ({ slot: s, taskId: picks[s.id] ?? s.taskId }));
}

const daysBetweenInclusive = (a: string, b: string) =>
	Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1);

function progressionFor(
	p: Progression | null,
	marks: Parameters<typeof hitsInARow>[0],
	since: string | null,
	variantIds: string[]
) {
	if (!p) return null;
	const hits = hitsInARow(marks, since);
	return hits >= p.after ? { hits, by: p.by, unit: p.unit, changes: previewRaise(p, variantIds) } : null;
}

/** What Raise would change, as "Bench press: Reps 8→9, Weight 80→84", one line per Task. */
function previewRaise(p: Progression, variantIds: string[]): string[] {
	if (!variantIds.length) return [];
	const slots = db
		.select()
		.from(slot)
		.where(inArray(slot.variantId, variantIds))
		.orderBy(asc(slot.sortOrder))
		.all()
		.filter((s) => s.taskId && s.targets && Object.keys(s.targets).length);
	const lines: string[] = [];
	for (const s of slots) {
		const t = db.select({ name: task.name }).from(task).where(eq(task.id, s.taskId!)).get();
		const names = new Map(
			db.select({ id: metric.id, name: metric.name }).from(metric).where(and(eq(metric.taskId, s.taskId!), eq(metric.archived, false))).all().map((m) => [m.id, m.name])
		);
		const next = raise(s.targets!, p, stepsOf(Object.keys(s.targets!)));
		const parts = Object.entries(s.targets!)
			.filter(([k]) => names.has(k))
			.map(([k, v]) => `${names.get(k)} ${v}→${next[k]}`);
		const line = `${t?.name ?? 'Task'}: ${parts.join(', ')}`;
		if (parts.length && !lines.includes(line)) lines.push(line);
	}
	return lines.length > 4 ? [...lines.slice(0, 3), `and ${lines.length - 3} more`] : lines;
}

/** Prep checklists for build habits due tomorrow. */
export function loadPrep(accountId: string, today: string): PrepItem[] {
	const tomorrow = addDays(today, 1);
	const habits = db
		.select()
		.from(habit)
		.where(and(eq(habit.accountId, accountId), eq(habit.archived, false), eq(habit.direction, 'build')))
		.orderBy(asc(habit.sortOrder), asc(habit.name))
		.all()
		.filter((h) => h.prep?.length && h.schedule);
	const out: PrepItem[] = [];
	for (const h of habits) {
		// Assume today's due Occurrence gets done, so a rotation looks one step ahead.
		const past = history(h.id, tomorrow);
		const todayOcc = db
			.select()
			.from(occurrence)
			.where(and(eq(occurrence.habitId, h.id), eq(occurrence.date, today)))
			.get();
		if (todayOcc?.status === 'due') past.push({ date: today, variantId: todayOcc.variantId, status: 'done' });
		if (!dueOn(h.schedule as Schedule, past, tomorrow, followDue(h.id, h.schedule, today))) continue;
		const ticks = new Set(
			db
				.select({ item: prepTick.item })
				.from(prepTick)
				.where(and(eq(prepTick.habitId, h.id), eq(prepTick.date, tomorrow)))
				.all()
				.map((t) => t.item)
		);
		out.push({
			habitId: h.id,
			name: h.name,
			date: tomorrow,
			items: h.prep!.map((item) => ({ item, done: ticks.has(item) }))
		});
	}
	return out;
}

/**
 * Mark an Occurrence done at a level without opening the Log screen: every fixed Slot
 * gets Entries from that level's targets (falling back to Target), so History shows them.
 */
/**
 * Required fields a one-tap log left empty, by "Task: field". A one-tap log that leaves one
 * empty is put back to due (its values kept) so the quick log screen can ask for it.
 */
export function missingRequired(occurrenceId: string): string[] {
	const occ = db.select().from(occurrence).where(eq(occurrence.id, occurrenceId)).get();
	if (!occ) return [];
	const entries = db.select().from(entry).where(eq(entry.occurrenceId, occ.id)).all();
	const empty = (v: unknown) => v === undefined || v === null || v === '' || v === false;
	const out: string[] = [];
	const positions = positionsOf(occ);
	const { at } = place(positions, entries);
	for (const p of positions) {
		const required = db
			.select()
			.from(metric)
			.where(and(eq(metric.taskId, p.taskId), eq(metric.required, true), eq(metric.archived, false)))
			.all();
		if (!required.length) continue;
		const name = db.select({ name: task.name }).from(task).where(eq(task.id, p.taskId)).get()?.name ?? '';
		const mine = at.get(p.path) ?? [];
		const sets = mine.filter((e) => !(e.values as Record<string, unknown>)._summary);
		const summary = (mine.find((e) => (e.values as Record<string, unknown>)._summary)?.values ?? {}) as Record<string, unknown>;
		for (const m of required) {
			const bad = m.repeats
				? !sets.length || sets.some((e) => empty((e.values as Record<string, unknown>)[m.id]))
				: empty(summary[m.id]) && !sets.some((e) => !empty((e.values as Record<string, unknown>)[m.id]));
			if (bad && !out.includes(`${name}: ${m.name}`)) out.push(`${name}: ${m.name}`);
		}
	}
	return out;
}

/** After a one-tap log: if a required field is empty, back to due. True when input is needed. */
function needsInput(occurrenceId: string): boolean {
	if (!missingRequired(occurrenceId).length) return false;
	db.update(occurrence).set({ status: 'due', finishedAt: null }).where(eq(occurrence.id, occurrenceId)).run();
	return true;
}

/** A Yes or no Task or a step: no fields and nothing inside, so logging it is a tick. */
function isTickOnly(tx: Tx, p: Pick<Position, 'taskId' | 'kids'>): boolean {
	return !p.kids && !tx.select({ id: metric.id }).from(metric).where(and(eq(metric.taskId, p.taskId), eq(metric.archived, false))).get();
}

/** One tap: done at a level with its targets. Returns 'needsInput' when a required field is still empty. */
export function quickDone(occurrenceId: string, level: Level | null): 'done' | 'needsInput' | 'gone' {
	ensurePicks(occurrenceId);
	const occ = db.select().from(occurrence).where(eq(occurrence.id, occurrenceId)).get();
	if (!occ) return 'gone';
	db.transaction((tx) => {
		// One tap logs that level's targets, replacing anything an earlier tap or log left behind.
		tx.delete(entry).where(eq(entry.occurrenceId, occ.id)).run();
		let order = 0;
		// Every place in the log, parts and rounds included. "Done" means every step: a Yes or
		// no Task and each step inside a Task is ticked.
		for (const p of positionsOf(occ, { q: tx })) {
			const add = (values: Record<string, unknown>) =>
				tx.insert(entry).values({ id: randomUUID(), occurrenceId: occ.id, taskId: p.taskId, path: p.path, values, sortOrder: order++ }).run();
			for (const values of targetEntries(tx, p, p.taskId, level)) add(values);
			if (isTickOnly(tx, p)) add({ done: true });
		}
		tx.update(occurrence)
			.set({ status: 'done', finishedAt: new Date(), level: level === 'target' ? null : level })
			.where(eq(occurrence.id, occ.id))
			.run();
	});
	return needsInput(occ.id) ? 'needsInput' : 'done';
}

/**
 * Fields set to start blank: a reading such as today's weight is never copied from an old day.
 * Archived fields aren't either: they are kept for History, not logged again.
 */
function blankMetricIds(tx: Tx, taskId: string): Set<string> {
	return new Set(
		tx
			.select({ id: metric.id, prefill: metric.prefill, archived: metric.archived })
			.from(metric)
			.where(eq(metric.taskId, taskId))
			.all()
			.filter((m) => m.prefill === 'blank' || m.archived)
			.map((m) => m.id)
	);
}

type Values = Record<string, unknown>;

/**
 * "Same as last time": copy the last finished log (of the same Variant when there is one, and
 * from before this day) and finish. Everything comes from that one log, so values from
 * different days never mix: sets, single values, tick boxes, ticked steps, and the Task an
 * auto-filled Slot used. Places are matched by Task and how many times it came before, so
 * round 2 of a Circuit copies round 2. A place that log didn't have takes its Task's own last
 * log, then the targets. Fields set to start blank are never copied. Places already logged
 * here are kept as they are, so a half-done workout only gets the rest filled in.
 * Returns 'needsInput', with the Occurrence back to due, when a required field is still empty
 * or a Task got nothing to log, so the quick log can ask for it.
 */
export function sameAsLast(occurrenceId: string): 'done' | 'needsInput' | 'gone' {
	ensurePicks(occurrenceId);
	let occ = db.select().from(occurrence).where(eq(occurrence.id, occurrenceId)).get();
	if (!occ) return 'gone';
	const finished = db
		.select({ id: occurrence.id, date: occurrence.date, level: occurrence.level, variantId: occurrence.variantId, picks: occurrence.picks })
		.from(occurrence)
		.where(and(eq(occurrence.habitId, occ.habitId), eq(occurrence.status, 'done')))
		.orderBy(desc(occurrence.date), desc(occurrence.finishedAt))
		.all();
	const source =
		lastTimeFor(
			finished.filter((o) => o.variantId === occ!.variantId),
			occ
		) ?? lastTimeFor(finished, occ);
	const lastLevel = source?.level ?? null;
	const from = source
		? db
				.select({ taskId: entry.taskId, path: entry.path, values: entry.values })
				.from(entry)
				.where(eq(entry.occurrenceId, source.id))
				.orderBy(asc(entry.sortOrder))
				.all()
		: [];

	// An auto-filled Slot uses the Task it used last time, so there is something to copy.
	if (source?.picks && occ.variantId === source.variantId) {
		const picks = { ...(occ.picks ?? {}) };
		let changed = false;
		for (const { slot: s } of slotsOf(occ)) {
			const was = source.picks[s.id];
			if (s.fillRule && was && picks[s.id] !== was && from.some((e) => e.taskId === was)) {
				picks[s.id] = was;
				changed = true;
			}
		}
		if (changed) {
			db.update(occurrence).set({ picks }).where(eq(occurrence.id, occ.id)).run();
			occ = { ...occ, picks };
		}
	}

	let empty = false;
	db.transaction((tx) => {
		const have = tx
			.select({ taskId: entry.taskId, path: entry.path, values: entry.values, sortOrder: entry.sortOrder })
			.from(entry)
			.where(eq(entry.occurrenceId, occ!.id))
			.orderBy(asc(entry.sortOrder))
			.all();
		const positions = positionsOf(occ!, { q: tx });
		const here = place(positions, have).at;
		// The places of that log, by Task and how many times the Task came before.
		const keyed = (ps: Position[]) => {
			const n = new Map<string, number>();
			return ps.map((p) => {
				const k = n.get(p.taskId) ?? 0;
				n.set(p.taskId, k + 1);
				return { p, key: `${p.taskId}|${k}` };
			});
		};
		const srcPositions = source ? positionsOf(source, { q: tx, keep: partIdsIn(from) }) : [];
		const srcAt = place(srcPositions, from).at;
		const inSource = new Map(keyed(srcPositions).map(({ p, key }) => [key, (srcAt.get(p.path) ?? []).map((e) => e.values)]));
		let order = have.reduce((n, e) => Math.max(n, e.sortOrder + 1), 0);
		for (const { p, key } of keyed(positions)) {
			// Logged here already: kept, never filled a second time.
			if (here.get(p.path)?.length) continue;
			const add = (values: Values) =>
				tx.insert(entry).values({ id: randomUUID(), occurrenceId: occ!.id, taskId: p.taskId, path: p.path, values, sortOrder: order++ }).run();
			// From the one log above; a place it didn't have falls back to its Task's own last log.
			const prev = inSource.get(key) ?? lastEntries(p.taskId, occ!.id, p.path);
			if (isTickOnly(tx, p)) {
				if (prev.some(isTick)) add({ done: true });
				continue;
			}
			const blank = blankMetricIds(tx, p.taskId);
			let wrote = 0;
			for (const values of prev.length ? prev : targetEntries(tx, p, p.taskId, lastLevel)) {
				const kept = Object.fromEntries(Object.entries(values).filter(([k]) => !blank.has(k)));
				if (Object.keys(kept).some((k) => k !== '_summary')) {
					add(kept);
					wrote++;
				}
			}
			// Nothing to copy: ask on the quick log, if it has a field to ask with.
			if (!wrote && tx.select({ id: metric.id }).from(metric).where(and(eq(metric.taskId, p.taskId), eq(metric.archived, false), or(eq(metric.quick, true), eq(metric.required, true)))).get())
				empty = true;
		}
		tx.update(occurrence)
			.set({ status: 'done', finishedAt: new Date(), level: lastLevel })
			.where(eq(occurrence.id, occ!.id))
			.run();
	});
	if (empty) {
		db.update(occurrence).set({ status: 'due', finishedAt: null }).where(eq(occurrence.id, occ.id)).run();
		return 'needsInput';
	}
	return needsInput(occ.id) ? 'needsInput' : 'done';
}

/** Put a finished or skipped Occurrence back to due. `clear` also removes its Entries (undoing a one-tap log). */
export function reopen(occurrenceId: string, clear: boolean) {
	db.transaction((tx) => {
		if (clear) tx.delete(entry).where(eq(entry.occurrenceId, occurrenceId)).run();
		tx.update(occurrence)
			.set({ status: 'due', finishedAt: null, level: null })
			.where(eq(occurrence.id, occurrenceId))
			.run();
	});
}

/**
 * The most recent Entries of a Task before a given Occurrence, used to prefill. With a `path`,
 * the ones from the same place last time (round 2 of a Circuit prefills round 2), else the
 * first place it had there, so rounds and Slots don't run together.
 */
export function lastEntries(taskId: string, beforeOccurrenceId: string, path?: string) {
	const occ = db
		.select({ id: occurrence.id, date: occurrence.date })
		.from(occurrence)
		.where(eq(occurrence.id, beforeOccurrenceId))
		.get();
	const prev = lastTimeFor(
		db
			.select({ id: occurrence.id, date: occurrence.date })
			.from(entry)
			.innerJoin(occurrence, eq(entry.occurrenceId, occurrence.id))
			.where(and(eq(entry.taskId, taskId), eq(occurrence.status, 'done')))
			.orderBy(desc(occurrence.date), desc(occurrence.finishedAt))
			.all(),
		occ
	);
	if (!prev) return [];
	const rows = db
		.select({ values: entry.values, path: entry.path })
		.from(entry)
		.where(and(eq(entry.occurrenceId, prev.id), eq(entry.taskId, taskId)))
		.orderBy(asc(entry.sortOrder))
		.all();
	const placed = rows.filter((r) => r.path);
	if (!path || !placed.length) return rows.map((e) => e.values);
	// The place below the Slot: Slots differ between Variants, the parts and rounds don't.
	const tail = (p: string) => p.slice(slotOfPath(p).length);
	const same = placed.filter((r) => tail(r.path!) === tail(path));
	return (same.length ? same : placed.filter((r) => r.path === placed[0].path)).map((e) => e.values);
}
