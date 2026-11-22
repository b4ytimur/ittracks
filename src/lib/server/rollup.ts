// Habits inside other habits. A group (a build habit whose Schedule is a group) has no days of
// its own: each day is worked out from the habits inside it (engine/rollup.ts) and stored as
// the group's Occurrence, so streaks, Stats, History, export and the API read groups like any
// habit. A routine has days of its own (its Schedule), and on each of them it is judged from
// the habits inside that were due that day; a habit inside can follow it (a Follow schedule)
// and be due whenever it is. The stored results are derived data: syncParents writes them
// again from what is inside, so moving a habit in or out counts the parent's past days again.
import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence, pause, slot, variant } from './db/schema';
import { dueOn, isFollow, isGroup, rollupRuleOf, type Done, type ParentDue, type RollupRule, type Schedule } from '$lib/engine/schedule';
import { rollupDay, type ChildDay, type GroupDay } from '$lib/engine/rollup';
import { deepestFirst } from '$lib/engine/tree';
import { scheduleOn, type EarlierSchedule } from '$lib/engine/unlogged';
import { pauseOn, type Pause } from '$lib/engine/pause';

interface GroupRow {
	id: string;
	parentId: string | null;
	startDate: string;
	schedule: unknown;
	earlierSchedules: EarlierSchedule[] | null;
	archived: boolean;
}

/** The parent's rule on a day, from the schedule it had then. */
function ruleOn(g: GroupRow, date: string): RollupRule {
	return rollupRuleOf(scheduleOn(g.schedule as Schedule, g.earlierSchedules, date));
}

/** The account's build habits with their parent links, for tree checks. */
export function habitTree(accountId: string) {
	return db
		.select({ id: habit.id, parentId: habit.parentId, schedule: habit.schedule, archived: habit.archived, direction: habit.direction, name: habit.name })
		.from(habit)
		.where(eq(habit.accountId, accountId))
		.all();
}

/**
 * Write every group's and routine's days from the habits inside them, deepest first, from the
 * parent's start through today. The habits inside should be settled first (see today.ts), so
 * their past days are final. Archived parents keep the days they had. Archived habits inside
 * still count for the days they were logged.
 */
export function syncParents(accountId: string, today: string, pauses: Pause[]) {
	const all = db
		.select({
			id: habit.id,
			parentId: habit.parentId,
			startDate: habit.startDate,
			schedule: habit.schedule,
			earlierSchedules: habit.earlierSchedules,
			archived: habit.archived,
			direction: habit.direction
		})
		.from(habit)
		.where(eq(habit.accountId, accountId))
		.all();
	const withKids = new Set(all.filter((h) => h.parentId && h.direction === 'build').map((h) => h.parentId!));
	const parents = all.filter(
		(h) => h.direction === 'build' && !h.archived && h.schedule && (isGroup(h.schedule as Schedule) || withKids.has(h.id))
	);
	for (const g of deepestFirst(parents, all)) {
		if (isGroup(g.schedule as Schedule)) syncGroup(g, all, today, pauses);
		else syncRoutine(g, all, today);
	}
}

/**
 * A routine's days are its own (its schedule, settled like any habit's). On each one, the
 * habits inside that were due that day decide it; a day with none of them due stays as it
 * was logged, like any Yes or no day.
 */
function syncRoutine(r: GroupRow, all: { id: string; parentId: string | null; direction: string }[], today: string) {
	const kids = all.filter((h) => h.parentId === r.id && h.direction === 'build').map((h) => h.id);
	const own = db
		.select({ id: occurrence.id, date: occurrence.date, status: occurrence.status, level: occurrence.level, rollup: occurrence.rollup })
		.from(occurrence)
		.where(and(eq(occurrence.habitId, r.id), lte(occurrence.date, today)))
		.all();
	if (!own.length) return;
	const days = new Map<string, ChildDay[]>();
	if (kids.length) {
		const rows = db
			.select({ date: occurrence.date, status: occurrence.status, level: occurrence.level, extra: occurrence.extra })
			.from(occurrence)
			.where(and(inArray(occurrence.habitId, kids), inArray(occurrence.date, [...new Set(own.map((o) => o.date))])))
			.all();
		for (const row of rows) days.set(row.date, [...(days.get(row.date) ?? []), row]);
	}
	const now = new Date();
	db.transaction((tx) => {
		for (const row of own) {
			const day = rollupDay(days.get(row.date) ?? [], ruleOn(r, row.date), { past: row.date < today });
			if (!day) {
				if (row.rollup) tx.update(occurrence).set({ rollup: null }).where(eq(occurrence.id, row.id)).run();
				continue;
			}
			const rollup = { done: day.done, total: day.total };
			if (row.status === day.status && row.level === day.level && JSON.stringify(row.rollup) === JSON.stringify(rollup)) continue;
			tx.update(occurrence)
				.set({ status: day.status, level: day.level, rollup, finishedAt: day.status === 'done' ? (row.status === 'done' ? undefined : now) : null })
				.where(eq(occurrence.id, row.id))
				.run();
		}
	});
}

/**
 * For a habit that follows its parent: what the parent has due each day. Up to today, the
 * parent's own Occurrences say (a day logged when nothing was due doesn't count, and neither
 * does a paused day left open); after today, its schedule does. A parent that is gone, a
 * group, or a break habit has nothing due, so neither does the habit that follows it.
 */
export function parentDueFor(childId: string, today: string): ParentDue {
	const child = db.select({ parentId: habit.parentId }).from(habit).where(eq(habit.id, childId)).get();
	const parent = child?.parentId
		? db
				.select({ id: habit.id, accountId: habit.accountId, schedule: habit.schedule, earlierSchedules: habit.earlierSchedules, direction: habit.direction })
				.from(habit)
				.where(eq(habit.id, child.parentId))
				.get()
		: undefined;
	if (!parent || parent.direction !== 'build' || !parent.schedule || isGroup(parent.schedule as Schedule)) return () => null;
	const pauses: Pause[] = db.select({ habitId: pause.habitId, start: pause.start, end: pause.end }).from(pause).where(eq(pause.accountId, parent.accountId)).all();
	const rows = db
		.select({ date: occurrence.date, variantId: occurrence.variantId, status: occurrence.status, extra: occurrence.extra })
		.from(occurrence)
		.where(eq(occurrence.habitId, parent.id))
		.all();
	const byDate = new Map<string, string>();
	for (const r of rows)
		if (!r.extra && !(r.status === 'due' && pauseOn(pauses, parent.id, r.date))) byDate.set(r.date, r.variantId ?? '');
	const acted = rows.filter((r) => r.status === 'done' || r.status === 'skipped') as (Done & { extra: boolean })[];
	return (date) => {
		if (date <= today) return byDate.get(date) ?? null;
		if (pauseOn(pauses, parent.id, date)) return null;
		const s = scheduleOn(parent.schedule as Schedule, parent.earlierSchedules, date);
		// A parent that follows its own parent: one level up decides.
		return dueOn(s, acted.filter((a) => a.date < date), date, isFollow(s) ? parentDueFor(parent.id, today) : undefined);
	};
}

/** For a habit that follows its parent, what the parent has due; undefined for any other schedule. */
export const followDue = (habitId: string, schedule: unknown, today: string): ParentDue | undefined =>
	isFollow(schedule as Schedule | null) ? parentDueFor(habitId, today) : undefined;

/** A routine: a build habit with a schedule of its own (not a group) and habits inside it. */
export function isRoutine(habitId: string): boolean {
	const h = db.select({ schedule: habit.schedule, direction: habit.direction }).from(habit).where(eq(habit.id, habitId)).get();
	if (!h || h.direction !== 'build' || !h.schedule || isGroup(h.schedule as Schedule)) return false;
	return !!db
		.select({ id: habit.id })
		.from(habit)
		.where(and(eq(habit.parentId, habitId), eq(habit.direction, 'build')))
		.get();
}

/** Does any Variant of this habit have a Slot? A habit with Tasks of its own can't hold habits yet. */
export function hasOwnTasks(habitId: string): boolean {
	return !!db
		.select({ id: slot.id })
		.from(slot)
		.innerJoin(variant, eq(slot.variantId, variant.id))
		.where(eq(variant.habitId, habitId))
		.get();
}

/** The Occurrences of the habits inside a parent on a date (not archived ones). */
export function kidsOn(parentId: string, date: string) {
	return db
		.select({ occ: occurrence, habit: { id: habit.id, name: habit.name, accountId: habit.accountId } })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(and(eq(habit.parentId, parentId), eq(habit.direction, 'build'), eq(habit.archived, false), eq(occurrence.date, date)))
		.orderBy(habit.sortOrder, habit.name)
		.all();
}

function syncGroup(g: GroupRow, all: { id: string; parentId: string | null; direction: string }[], today: string, pauses: Pause[]) {
	const kids = all.filter((h) => h.parentId === g.id && h.direction === 'build').map((h) => h.id);
	const days = new Map<string, ChildDay[]>();
	if (kids.length && g.startDate <= today) {
		const rows = db
			.select({ date: occurrence.date, status: occurrence.status, extra: occurrence.extra })
			.from(occurrence)
			.where(and(inArray(occurrence.habitId, kids), gte(occurrence.date, g.startDate), lte(occurrence.date, today)))
			.all();
		for (const r of rows) days.set(r.date, [...(days.get(r.date) ?? []), r]);
	}
	const want = new Map<string, GroupDay>();
	for (const [date, children] of days) {
		const day = rollupDay(children, ruleOn(g, date), { past: date < today });
		// On a paused day nothing was due: only a day that was done anyway is kept.
		if (day && (day.status === 'done' || !pauseOn(pauses, g.id, date))) want.set(date, day);
	}
	const have = db
		.select({ id: occurrence.id, date: occurrence.date, status: occurrence.status, level: occurrence.level, rollup: occurrence.rollup })
		.from(occurrence)
		.where(eq(occurrence.habitId, g.id))
		.all();
	const now = new Date();
	db.transaction((tx) => {
		const seen = new Set<string>();
		for (const row of have) {
			const day = want.get(row.date);
			if (!day || seen.has(row.date)) {
				tx.delete(occurrence).where(eq(occurrence.id, row.id)).run();
				continue;
			}
			seen.add(row.date);
			const rollup = { done: day.done, total: day.total };
			if (row.status === day.status && row.level === day.level && JSON.stringify(row.rollup) === JSON.stringify(rollup)) continue;
			tx.update(occurrence)
				.set({
					status: day.status,
					level: day.level,
					rollup,
					finishedAt: day.status === 'done' ? (row.status === 'done' ? undefined : now) : null
				})
				.where(eq(occurrence.id, row.id))
				.run();
		}
		for (const [date, day] of want) {
			if (seen.has(date)) continue;
			tx.insert(occurrence)
				.values({
					id: randomUUID(),
					habitId: g.id,
					variantId: null,
					date,
					status: day.status,
					picks: null,
					notes: null,
					finishedAt: day.status === 'done' ? now : null,
					level: day.level,
					extra: false,
					goals: null,
					rollup: { done: day.done, total: day.total }
				})
				.run();
		}
	});
}

/** Is this habit a group? */
export function isGroupHabit(habitId: string): boolean {
	const h = db.select({ schedule: habit.schedule }).from(habit).where(eq(habit.id, habitId)).get();
	return isGroup(h?.schedule as Schedule | null);
}
