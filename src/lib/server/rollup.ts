// Habits inside other habits. A group (a build habit whose Schedule is a group) has no days of
// its own: each day is worked out from the habits inside it (engine/rollup.ts) and stored as
// the group's Occurrence, so streaks, Stats, History, export and the API read groups like any
// habit. A routine has days of its own (its Schedule), and on each of them it is judged from
// the habits inside that were due that day; a habit inside can follow it (a Follow schedule)
// and be due whenever it is. The stored results are derived data: syncParents writes them
// again from the habits that were inside on each day. Moving a habit in or out applies from
// that day on (habit.earlierParents keeps where it sat before), so past days keep their habits.
import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, like, lte, or } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence, pause, slot, variant } from './db/schema';
import { dueOn, isFollow, isGroup, rollupRuleOf, type Done, type ParentDue, type RollupRule, type Schedule } from '$lib/engine/schedule';
import { rollupDay, type ChildDay, type GroupDay } from '$lib/engine/rollup';
import { deepestFirst, parentOn, parentsEver, type EarlierParent } from '$lib/engine/tree';
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

/** A habit's place in the tree over time: where it sits now, and where it sat before. */
interface Member {
	id: string;
	parentId: string | null;
	earlierParents: EarlierParent[] | null;
	direction: string;
}

/** The build habits that sat in `parentId` on some day. */
const membersOf = <T extends Member>(all: T[], parentId: string): T[] =>
	all.filter((h) => h.direction === 'build' && parentsEver(h.parentId, h.earlierParents).includes(parentId));

/** Was `h` inside `parentId` on `date`? */
const insideOn = (h: Member, parentId: string, date: string) => parentOn(h.parentId, h.earlierParents, date) === parentId;

/** Build habits that sit in `parentId` now or sat in it before (not archived ones, unless asked). */
function everInside(parentId: string, opts: { archived?: boolean } = {}): (Member & { name: string; accountId: string; sortOrder: number })[] {
	return db
		.select({
			id: habit.id,
			parentId: habit.parentId,
			earlierParents: habit.earlierParents,
			direction: habit.direction,
			name: habit.name,
			accountId: habit.accountId,
			sortOrder: habit.sortOrder,
			archived: habit.archived
		})
		.from(habit)
		.where(and(eq(habit.direction, 'build'), or(eq(habit.parentId, parentId), like(habit.earlierParents, `%"${parentId}"%`))))
		.all()
		.filter((h) => (opts.archived || !h.archived) && parentsEver(h.parentId, h.earlierParents).includes(parentId));
}

/** The build habits inside a parent on a date (now, with no date); archived ones only when asked. */
export function insideAt(parentId: string, date?: string, opts: { archived?: boolean } = {}) {
	return everInside(parentId, opts).filter((h) => (date ? insideOn(h, parentId, date) : h.parentId === parentId));
}

/** The account's build habits with their parent links, for tree checks. */
export function habitTree(accountId: string) {
	return db
		.select({ id: habit.id, parentId: habit.parentId, schedule: habit.schedule, archived: habit.archived, direction: habit.direction, name: habit.name })
		.from(habit)
		.where(eq(habit.accountId, accountId))
		.all();
}

/** A routine's past day that became done or skipped, or stopped being either, from the habits inside it. */
export interface Flipped {
	habitId: string;
	date: string;
}

/**
 * Write every group's and routine's days from the habits inside them, deepest first, from the
 * parent's start through today. The habits inside should be settled first (see today.ts), so
 * their past days are final. Archived parents keep the days they had. Archived habits inside
 * still count for the days they were logged. Returns the routines' past days that flipped
 * between done (or skipped) and not, since a plan that carries over moves with them.
 */
export function syncParents(accountId: string, today: string, pauses: Pause[]): Flipped[] {
	const all = db
		.select({
			id: habit.id,
			parentId: habit.parentId,
			startDate: habit.startDate,
			schedule: habit.schedule,
			earlierSchedules: habit.earlierSchedules,
			archived: habit.archived,
			direction: habit.direction,
			earlierParents: habit.earlierParents
		})
		.from(habit)
		.where(eq(habit.accountId, accountId))
		.all();
	// Habits that hold habits now, or held some on days they keep.
	const withKids = new Set(all.filter((h) => h.direction === 'build').flatMap((h) => parentsEver(h.parentId, h.earlierParents)));
	const parents = all.filter(
		(h) => h.direction === 'build' && !h.archived && h.schedule && (isGroup(h.schedule as Schedule) || withKids.has(h.id))
	);
	const flipped: Flipped[] = [];
	for (const g of deepestFirst(parents, all)) {
		if (isGroup(g.schedule as Schedule)) syncGroup(g, all, today, pauses);
		else flipped.push(...syncRoutine(g, all, today).map((date) => ({ habitId: g.id, date })));
	}
	return flipped;
}

const acted = (status: string) => status === 'done' || status === 'skipped';

/**
 * A routine's days are its own (its schedule, settled like any habit's). On each one, the
 * habits inside that were due that day decide it; a day with none of them due stays as it
 * was logged, like any Yes or no day.
 */
function syncRoutine(r: GroupRow, all: Member[], today: string): string[] {
	const members = new Map(membersOf(all, r.id).map((h) => [h.id, h]));
	const kids = [...members.keys()];
	const own = db
		.select({ id: occurrence.id, date: occurrence.date, status: occurrence.status, level: occurrence.level, rollup: occurrence.rollup })
		.from(occurrence)
		.where(and(eq(occurrence.habitId, r.id), lte(occurrence.date, today)))
		.all();
	const flipped: string[] = [];
	if (!own.length) return flipped;
	const days = new Map<string, ChildDay[]>();
	if (kids.length) {
		const rows = db
			.select({ habitId: occurrence.habitId, date: occurrence.date, status: occurrence.status, level: occurrence.level, extra: occurrence.extra })
			.from(occurrence)
			.where(and(inArray(occurrence.habitId, kids), inArray(occurrence.date, [...new Set(own.map((o) => o.date))])))
			.all()
			// Only habits that were inside it that day.
			.filter((row) => insideOn(members.get(row.habitId)!, r.id, row.date));
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
			if (row.date < today && acted(row.status) !== acted(day.status)) flipped.push(row.date);
			tx.update(occurrence)
				.set({ status: day.status, level: day.level, rollup, finishedAt: day.status === 'done' ? (row.status === 'done' ? undefined : now) : null })
				.where(eq(occurrence.id, row.id))
				.run();
		}
	});
	return flipped;
}

/**
 * For a habit that follows its parent: what the parent has due each day. Up to today, the
 * parent's own Occurrences say (a day logged when nothing was due doesn't count, and neither
 * does a paused day left open); after today, its schedule does. A parent that is gone, a
 * group, or a break habit has nothing due, so neither does the habit that follows it.
 */
export function parentDueFor(childId: string, today: string): ParentDue {
	const child = db.select({ parentId: habit.parentId, earlierParents: habit.earlierParents }).from(habit).where(eq(habit.id, childId)).get();
	if (!child) return () => null;
	// The routine it sat in on each day: a habit moved out keeps its old routine's days for its past.
	const due = new Map(parentsEver(child.parentId, child.earlierParents).map((id) => [id, dueOf(id, today)]));
	return (date) => {
		const id = parentOn(child.parentId, child.earlierParents, date);
		return id ? (due.get(id)?.(date) ?? null) : null;
	};
}

/**
 * What one habit has due each day, for the habits that follow it. Up to today, its own
 * Occurrences say; after today, its schedule does.
 */
function dueOf(parentId: string, today: string): ParentDue {
	const parent = db
		.select({ id: habit.id, accountId: habit.accountId, schedule: habit.schedule, earlierSchedules: habit.earlierSchedules, direction: habit.direction })
		.from(habit)
		.where(eq(habit.id, parentId))
		.get();
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

/**
 * A routine: a build habit with a schedule of its own (not a group) and habits inside it, now
 * or, with a date, on that day (habits moved out later still count for its days before).
 */
export function isRoutine(habitId: string, date?: string): boolean {
	const h = db.select({ schedule: habit.schedule, direction: habit.direction }).from(habit).where(eq(habit.id, habitId)).get();
	if (!h || h.direction !== 'build' || !h.schedule || isGroup(h.schedule as Schedule)) return false;
	if (date) return everInside(habitId, { archived: true }).some((k) => insideOn(k, habitId, date));
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
		.where(and(eq(variant.habitId, habitId), eq(variant.archived, false)))
		.get();
}

/** The Occurrences of the habits inside a parent on a date (that were inside it that day; not archived ones). */
export function kidsOn(parentId: string, date: string) {
	const kids = insideAt(parentId, date).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
	if (!kids.length) return [];
	const occs = new Map(
		db
			.select()
			.from(occurrence)
			.where(and(inArray(occurrence.habitId, kids.map((k) => k.id)), eq(occurrence.date, date)))
			.all()
			.map((o) => [o.habitId, o])
	);
	return kids.flatMap((k) => {
		const occ = occs.get(k.id);
		return occ ? [{ occ, habit: { id: k.id, name: k.name, accountId: k.accountId } }] : [];
	});
}

function syncGroup(g: GroupRow, all: Member[], today: string, pauses: Pause[]) {
	const members = new Map(membersOf(all, g.id).map((h) => [h.id, h]));
	const kids = [...members.keys()];
	const days = new Map<string, ChildDay[]>();
	if (kids.length && g.startDate <= today) {
		const rows = db
			.select({ habitId: occurrence.habitId, date: occurrence.date, status: occurrence.status, extra: occurrence.extra })
			.from(occurrence)
			.where(and(inArray(occurrence.habitId, kids), gte(occurrence.date, g.startDate), lte(occurrence.date, today)))
			.all()
			// Only habits that were inside it that day: a move applies from that day on.
			.filter((r) => insideOn(members.get(r.habitId)!, g.id, r.date));
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
