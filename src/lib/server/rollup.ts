// Habits inside groups. A group (a build habit whose Schedule is a group) has no days of its
// own: each day is worked out from the habits inside it (engine/rollup.ts) and stored as the
// group's Occurrence, so streaks, Stats, History, export and the API read groups like any habit.
// The stored days are derived data: syncGroups writes them again from what is inside, so
// moving a habit into or out of a group counts that group's past days again.
import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from './db';
import { habit, occurrence } from './db/schema';
import { isGroup, type GroupRule, type Schedule } from '$lib/engine/schedule';
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

/** The group rule on a day. An earlier plan that wasn't a group (it had no logs) counts as "all". */
function ruleOn(g: GroupRow, date: string): GroupRule {
	const s = scheduleOn(g.schedule as Schedule, g.earlierSchedules, date);
	return isGroup(s) ? s : { kind: 'group', target: null, minimum: null };
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
 * Write every group's days from the habits inside it, deepest groups first, from the group's
 * start through today. The habits inside should be settled first (see today.ts), so their
 * past days are final. Archived groups keep the days they had. Archived habits inside still
 * count for the days they were logged.
 */
export function syncGroups(accountId: string, today: string, pauses: Pause[]) {
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
	const groups = all.filter((h) => h.direction === 'build' && isGroup(h.schedule as Schedule | null) && !h.archived);
	if (!groups.length) return;
	for (const g of deepestFirst(groups, all)) syncGroup(g, all, today, pauses);
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
