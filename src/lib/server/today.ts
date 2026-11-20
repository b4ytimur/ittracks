// Turns Schedules into today's Occurrences, and gathers what the Today screen shows.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lt, max, or } from 'drizzle-orm';
import { db } from './db';
import {
	craving,
	entry,
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
import { weekStart } from '$lib/engine/dates';
import { DEFAULT_TRIGGERS, type ScheduleForm } from '$lib/forms';
import { identitiesByHabit } from './repo/identities';
import { getSettings } from './settings';
import { dayOrder, logicalDate } from '$lib/engine/day';
import { pauseOn, type Pause } from '$lib/engine/pause';

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
function settlePast(habitId: string, schedule: ScheduleForm, today: string, pauses: Pause[]) {
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
export function ensureToday(accountId: string, habitId: string, schedule: ScheduleForm, today: string) {
	const pauses = pausesForHabit(accountId, habitId);
	settlePast(habitId, schedule, today, pauses);
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
		finishedAt: null,
		level: null
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
	/** Started on the log screen and saved, not finished yet. */
	inProgress: boolean;
	/** A finished log exists to copy with "Same as last time". */
	canRepeat: boolean;
	areaId: string | null;
	/** Paused until this date (inclusive), for habits in a pause. */
	pausedUntil: string | null;
}

export interface BreakItem {
	habitId: string;
	name: string;
	days: number;
	longest: number;
	slippedToday: number;
	ifThen: { when: string; then: string; habit: string | null } | null;
	triggers: string[];
	places: string[];
	top: Trigger[];
	resistedThisWeek: number;
	identities: string[];
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
				days: daysSinceSlip(dates, h.startDate, today),
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
			pausedUntil: pauseOn(allPauses, h.id, today)?.end ?? null
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
	return { build, resting, paused, breaking };
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

/**
 * Mark an Occurrence done at a level without opening the Log screen: every fixed Slot
 * gets Entries from that level's targets (falling back to Target), so History shows them.
 */
export function quickDone(occurrenceId: string, level: Level | null) {
	const occ = db.select().from(occurrence).where(eq(occurrence.id, occurrenceId)).get();
	if (!occ) return;
	db.transaction((tx) => {
		const hasEntries = tx.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, occ.id)).get();
		if (!hasEntries) {
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
}

/**
 * "Same as last time": copy each Task's values from its last finished log (sets, single
 * values and sub-task ticks), use the targets for a Task never logged before, and finish.
 * Replaces anything saved so far. Returns false if the Occurrence is gone.
 */
export function sameAsLast(occurrenceId: string): boolean {
	const occ = db.select().from(occurrence).where(eq(occurrence.id, occurrenceId)).get();
	if (!occ) return false;
	const lastLevel =
		db
			.select({ level: occurrence.level })
			.from(occurrence)
			.where(and(eq(occurrence.habitId, occ.habitId), eq(occurrence.status, 'done')))
			.orderBy(desc(occurrence.date), desc(occurrence.finishedAt))
			.get()?.level ?? null;
	db.transaction((tx) => {
		tx.delete(entry).where(eq(entry.occurrenceId, occ.id)).run();
		let order = 0;
		const add = (taskId: string, values: Record<string, unknown>) =>
			tx.insert(entry).values({ id: randomUUID(), occurrenceId: occ.id, taskId, values, sortOrder: order++ }).run();
		for (const { slot: s, taskId } of slotsOf(occ)) {
			if (!taskId) continue;
			const prev = lastEntries(taskId, occ.id);
			for (const values of prev.length ? prev : targetEntries(tx, s, taskId, lastLevel)) add(taskId, values);
			const subs = tx.select({ id: task.id }).from(task).where(eq(task.parentTaskId, taskId)).all();
			for (const sub of subs) for (const values of lastEntries(sub.id, occ.id)) add(sub.id, values);
		}
		tx.update(occurrence)
			.set({ status: 'done', finishedAt: new Date(), level: lastLevel })
			.where(eq(occurrence.id, occ.id))
			.run();
	});
	return true;
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
