// Turns Schedules into today's Occurrences, and gathers what the Today screen shows.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, max, or } from 'drizzle-orm';
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
import { dueOn, nextInRotation, type Done, type Schedule } from '$lib/engine/schedule';
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
import { identitiesByHabit } from './repo/identities';
import { getSettings } from './settings';
import { dayOrder, logicalDate } from '$lib/engine/day';
import { pauseOn, type Pause } from '$lib/engine/pause';
import { carriesOver, lastTimeFor } from '$lib/engine/backfill';
import { missedDays, recountFrom, type Unlogged } from '$lib/engine/unlogged';
import { habitStats, type HabitStats } from '$lib/engine/stats';

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
	startDate: string;
	unlogged: Unlogged;
	settledThrough: string | null;
}

const settlingOf = (habitId: string): Settling | undefined =>
	db
		.select({ id: habit.id, startDate: habit.startDate, unlogged: habit.unlogged, settledThrough: habit.settledThrough })
		.from(habit)
		.where(eq(habit.id, habitId))
		.get();

/**
 * Settle past days. A due Occurrence that was never acted on becomes missed, and so does a
 * due day the app was never opened on (see engine/unlogged.ts), unless the habit is set to
 * ignore days you don't log: then an untouched day simply goes away. A waiting rotation and
 * a frequency target carry over to the next day, so their leftover due rows go away, and
 * their misses are counted per missed session instead.
 */
function settlePast(h: Settling, schedule: ScheduleForm, today: string, pauses: Pause[]) {
	const habitId = h.id;
	// Due days that fell in a pause simply go away: they were never due.
	if (pauses.length) {
		const old = db
			.select({ id: occurrence.id, date: occurrence.date })
			.from(occurrence)
			.where(and(eq(occurrence.habitId, habitId), eq(occurrence.status, 'due'), lt(occurrence.date, today)))
			.all()
			.filter((o) => pauseOn(pauses, habitId, o.date));
		if (old.length) db.delete(occurrence).where(inArray(occurrence.id, old.map((o) => o.id))).run();
	}
	const stale = and(
		eq(occurrence.habitId, habitId),
		eq(occurrence.status, 'due'),
		lt(occurrence.date, today)
	);
	const hasEntries = (id: string) => !!db.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, id)).get();
	if (carriesOver(schedule as Schedule)) {
		db.delete(occurrence).where(stale).run();
	} else {
		// A day the schedule never planned (a past day opened to log by hand, a rotation
		// started early) that was left without a log goes away instead of counting as a miss.
		// With unlogged days ignored, so does any due day left untouched.
		const gone = db
			.select({ id: occurrence.id, date: occurrence.date })
			.from(occurrence)
			.where(stale)
			.all()
			.filter(
				(o) =>
					!hasEntries(o.id) &&
					(h.unlogged === 'ignore' || !dueOn(schedule as Schedule, history(habitId, o.date), o.date))
			);
		if (gone.length) db.delete(occurrence).where(inArray(occurrence.id, gone.map((o) => o.id))).run();
		db.update(occurrence).set({ status: 'missed' }).where(stale).run();
	}
	const yesterday = addDays(today, -1);
	if (h.unlogged === 'missed') fillMisses(h, schedule, yesterday, pauses);
	if (!h.settledThrough || h.settledThrough < yesterday)
		db.update(habit).set({ settledThrough: yesterday }).where(eq(habit.id, habitId)).run();
}

/** Write a miss for every due day nobody logged since the habit was last settled. */
function fillMisses(h: Settling, schedule: ScheduleForm, yesterday: string, pauses: Pause[]) {
	const from = h.settledThrough ? addDays(h.settledThrough, 1) : h.startDate;
	if (from > yesterday) return;
	const rows = db
		.select({ date: occurrence.date, status: occurrence.status, variantId: occurrence.variantId, extra: occurrence.extra })
		.from(occurrence)
		.where(eq(occurrence.habitId, h.id))
		.all();
	const misses = missedDays(schedule as Schedule, rows, h.startDate, from, yesterday, (d) => !!pauseOn(pauses, h.id, d));
	if (!misses.length) return;
	const variants = new Set(db.select({ id: variant.id }).from(variant).where(eq(variant.habitId, h.id)).all().map((v) => v.id));
	db.transaction((tx) => {
		for (const m of misses)
			tx.insert(occurrence)
				.values({
					id: randomUUID(),
					habitId: h.id,
					variantId: m.variantId && variants.has(m.variantId) ? m.variantId : null,
					date: m.date,
					status: 'missed',
					picks: null,
					notes: null,
					finishedAt: null,
					level: null
				})
				.run();
	});
}

/** Settle a habit's past days without creating today's Occurrence. */
export function settle(accountId: string, habitId: string, schedule: ScheduleForm, today: string) {
	const h = settlingOf(habitId);
	if (h) settlePast(h, schedule, today, pausesForHabit(accountId, habitId));
}

/**
 * A past day changed: count the misses of a schedule that carries over again from where they
 * could have changed (see recountFrom), and settle. Misses with nothing logged in them are
 * the counted ones; anything else stays.
 */
export function recount(accountId: string, habitId: string, schedule: ScheduleForm, date: string, today: string) {
	const h = settlingOf(habitId);
	if (!h) return;
	const from = recountFrom(schedule as Schedule, date);
	if (from && h.unlogged === 'missed') {
		const ids = db
			.select({ id: occurrence.id })
			.from(occurrence)
			.where(and(eq(occurrence.habitId, habitId), eq(occurrence.status, 'missed'), gte(occurrence.date, from), lt(occurrence.date, today)))
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
	settlePast(h, schedule, today, pausesForHabit(accountId, habitId));
}

/** Settle every build habit of an account, so pages that read the past (Stats, the chain) see every miss. */
export function settleAll(accountId: string, today: string) {
	const rows = db
		.select({ id: habit.id, schedule: habit.schedule })
		.from(habit)
		.where(and(eq(habit.accountId, accountId), eq(habit.archived, false), eq(habit.direction, 'build')))
		.all();
	for (const r of rows) if (r.schedule) settle(accountId, r.id, r.schedule as ScheduleForm, today);
}

/** Create today's Occurrence for a build habit if one is due and none exists yet. */
export function ensureToday(accountId: string, habitId: string, schedule: ScheduleForm, today: string) {
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
	if (existing) return paused && existing.status === 'due' ? null : existing;
	if (paused) return null;
	const variantId = dueOn(schedule as Schedule, history(habitId, today), today);
	if (!variantId) return null;
	return createOccurrence(accountId, habitId, variantId, today);
}

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
		extra
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
	progression: { hits: number; by: number; unit: 'percent' | 'amount'; changes: string[] } | null;
	/** Started on the log screen and saved, not finished yet. */
	inProgress: boolean;
	/** A finished log exists to copy with "Same as last time". */
	canRepeat: boolean;
	areaId: string | null;
	/** Paused until this date (inclusive), for habits in a pause. */
	pausedUntil: string | null;
	stats: HabitStats;
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
	triggers: string[];
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
	const resting: TodayItem[] = [];
	const paused: TodayItem[] = [];
	const breaking: BreakItem[] = [];
	const idents = identitiesByHabit(accountId);
	const settings = getSettings(accountId);
	const dayStart = settings.dayStart ?? '00:00';
	const rangeStart = new Map(settings.ranges.map((r) => [r.name, r.start]));
	const allPauses = pausesOf(accountId);

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
				triggers: h.triggers ?? DEFAULT_TRIGGERS,
				places: [...new Set(slips.map((s) => s.place).filter((p): p is string => !!p))],
				top: topTriggers(slips),
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

		const occ = ensureToday(accountId, h.id, schedule, today);
		const variants = db.select().from(variant).where(eq(variant.habitId, h.id)).all();
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
						variantName: variants.find((v) => v.id === occ.variantId)?.name ?? null,
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
			stats: habitStats(marks, today)
		};
		if (occ) build.push(item);
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
		.where(and(eq(habit.accountId, accountId), gte(occurrence.date, monday), lte(occurrence.date, addDays(monday, 6))))
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
	s: typeof slot.$inferSelect,
	taskId: string,
	level: Level | null
): Record<string, unknown>[] {
	const targets = {
		...(s.targets ?? {}),
		...((level === 'minimum' ? s.minTargets : level === 'stretch' ? s.stretchTargets : null) ?? {})
	};
	const metrics = tx.select().from(metric).where(eq(metric.taskId, taskId)).all();
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
			db.select({ id: metric.id, name: metric.name }).from(metric).where(eq(metric.taskId, s.taskId!)).all().map((m) => [m.id, m.name])
		);
		const next = raise(s.targets!, p);
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
		if (!dueOn(h.schedule as Schedule, past, tomorrow)) continue;
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
	for (const { taskId } of slotsOf(occ)) {
		if (!taskId) continue;
		const required = db
			.select()
			.from(metric)
			.where(and(eq(metric.taskId, taskId), eq(metric.required, true)))
			.all();
		if (!required.length) continue;
		const name = db.select({ name: task.name }).from(task).where(eq(task.id, taskId)).get()?.name ?? '';
		const mine = entries.filter((e) => e.taskId === taskId);
		const sets = mine.filter((e) => !(e.values as Record<string, unknown>)._summary);
		const summary = (mine.find((e) => (e.values as Record<string, unknown>)._summary)?.values ?? {}) as Record<string, unknown>;
		for (const m of required) {
			const bad = m.repeats
				? !sets.length || sets.some((e) => empty((e.values as Record<string, unknown>)[m.id]))
				: empty(summary[m.id]) && !sets.some((e) => !empty((e.values as Record<string, unknown>)[m.id]));
			if (bad) out.push(`${name}: ${m.name}`);
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

/** One tap: done at a level with its targets. Returns 'needsInput' when a required field is still empty. */
export function quickDone(occurrenceId: string, level: Level | null): 'done' | 'needsInput' | 'gone' {
	const occ = db.select().from(occurrence).where(eq(occurrence.id, occurrenceId)).get();
	if (!occ) return 'gone';
	db.transaction((tx) => {
		// One tap logs that level's targets, replacing anything an earlier tap or log left behind.
		tx.delete(entry).where(eq(entry.occurrenceId, occ.id)).run();
		{
			let order = 0;
			for (const { slot: s, taskId } of slotsOf(occ)) {
				if (!taskId) continue;
				for (const values of targetEntries(tx, s, taskId, level))
					tx.insert(entry).values({ id: randomUUID(), occurrenceId: occ.id, taskId, values, sortOrder: order++ }).run();
			}
		}
		tx.update(occurrence)
			.set({ status: 'done', finishedAt: new Date(), level: level === 'target' ? null : level })
			.where(eq(occurrence.id, occ.id))
			.run();
	});
	return needsInput(occ.id) ? 'needsInput' : 'done';
}

/** Fields set to start blank: a reading such as today's weight is never copied from an old day. */
function blankMetricIds(tx: Tx, taskId: string): Set<string> {
	return new Set(
		tx
			.select({ id: metric.id, prefill: metric.prefill })
			.from(metric)
			.where(eq(metric.taskId, taskId))
			.all()
			.filter((m) => m.prefill === 'blank')
			.map((m) => m.id)
	);
}

type Values = Record<string, unknown>;

/**
 * A log's Entries of one Task, one group per Slot: a Variant can use the same Task twice.
 * Each Slot saves its sets first and its once-per-log values last, which closes the group.
 */
function slotGroups(entries: { taskId: string; values: Values }[], taskId: string): Values[][] {
	const groups: Values[][] = [];
	let cur: Values[] = [];
	for (const e of entries) {
		if (e.taskId !== taskId) continue;
		cur.push(e.values);
		if (e.values._summary) {
			groups.push(cur);
			cur = [];
		}
	}
	if (cur.length) groups.push(cur);
	return groups;
}

/**
 * "Same as last time": copy the last finished log (of the same Variant when there is one, and
 * from before this day) and finish. Everything comes from that one log, so values from
 * different days never mix: sets, single values, tick boxes, sub-task ticks, and the Task an
 * auto-filled Slot used. A Task that log didn't have takes its own last log, then the targets.
 * Fields set to start blank are never copied. Tasks already logged here are kept as they are,
 * so a half-done workout only gets the rest filled in.
 * Returns 'needsInput', with the Occurrence back to due, when a required field is still empty
 * or a Task got nothing to log, so the quick log can ask for it.
 */
export function sameAsLast(occurrenceId: string): 'done' | 'needsInput' | 'gone' {
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
				.select({ taskId: entry.taskId, values: entry.values })
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
		const have = tx.select({ taskId: entry.taskId, sortOrder: entry.sortOrder }).from(entry).where(eq(entry.occurrenceId, occ!.id)).all();
		const logged = new Set(have.map((e) => e.taskId));
		let order = have.reduce((n, e) => Math.max(n, e.sortOrder + 1), 0);
		const add = (taskId: string, values: Values) =>
			tx.insert(entry).values({ id: randomUUID(), occurrenceId: occ!.id, taskId, values, sortOrder: order++ }).run();
		const nth = new Map<string, number>();
		for (const { slot: s, taskId } of slotsOf(occ!)) {
			if (!taskId) continue;
			const n = nth.get(taskId) ?? 0;
			nth.set(taskId, n + 1);
			if (logged.has(taskId)) continue;
			const subs = tx.select({ id: task.id }).from(task).where(eq(task.parentTaskId, taskId)).all();
			const inSource = from.some((e) => e.taskId === taskId);
			// From the one log above; a Task it didn't have falls back to its own last log.
			const prevAll = inSource ? from : lastEntries(taskId, occ!.id).map((values) => ({ taskId, values }));
			const prev = slotGroups(prevAll, taskId)[n] ?? [];
			const blank = blankMetricIds(tx, taskId);
			let wrote = 0;
			for (const values of prev.length ? prev : targetEntries(tx, s, taskId, lastLevel)) {
				const kept = Object.fromEntries(Object.entries(values).filter(([k]) => !blank.has(k)));
				if (Object.keys(kept).some((k) => k !== '_summary')) {
					add(taskId, kept);
					wrote++;
				}
			}
			if (n === 0)
				for (const sub of subs) {
					const ticks = inSource ? from.filter((e) => e.taskId === sub.id).map((e) => e.values) : lastEntries(sub.id, occ!.id);
					for (const values of ticks.slice(0, 1)) {
						add(sub.id, values);
						wrote++;
					}
				}
			// Nothing to copy: ask on the quick log, if it has a field to ask with.
			if (!wrote && tx.select({ id: metric.id }).from(metric).where(and(eq(metric.taskId, taskId), or(eq(metric.quick, true), eq(metric.required, true)))).get())
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

/** The most recent Entries of a Task before a given Occurrence, used to prefill. */
export function lastEntries(taskId: string, beforeOccurrenceId: string) {
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
	return db
		.select({ values: entry.values })
		.from(entry)
		.where(and(eq(entry.occurrenceId, prev.id), eq(entry.taskId, taskId)))
		.orderBy(asc(entry.sortOrder))
		.all()
		.map((e) => e.values);
}
