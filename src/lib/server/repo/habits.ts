import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lt, notInArray } from 'drizzle-orm';
import { db } from '../db';
import { area, entry, habit, habitIdentity, identity, metric, occurrence, slot, variant } from '../db/schema';
import {
	DEFAULT_TRIGGERS,
	defaultLevels,
	emptyCue,
	type HabitForm,
	type ScheduleForm
} from '$lib/forms';
import { makesLoop } from '$lib/engine/stack';
import { keepEarlier, sameSchedule, scheduleStartBy, type EarlierSchedule } from '$lib/engine/unlogged';
import type { Schedule } from '$lib/engine/schedule';
import { keepGoals, rejudge } from '../progress';
import type { StreakRule } from '$lib/engine/streak';
import { checkHabit, checkHabitPast, type HabitCheck, type HabitCtx } from '$lib/rules/habit';
import { habitLogged, PastEditError } from '../history';

/** What the habit rules need to know from the database. */
export function habitCtx(f: HabitForm): HabitCtx {
	const ids = [...new Set(f.variants.flatMap((v) => v.slots.map((s) => s.taskId)).filter((x): x is string => !!x))];
	const repeating = new Set(
		ids.length
			? db
					.select({ taskId: metric.taskId })
					.from(metric)
					.where(and(inArray(metric.taskId, ids), eq(metric.repeats, true), eq(metric.archived, false)))
					.all()
					.map((r) => r.taskId)
			: []
	);
	return { taskRepeats: (id) => (ids.includes(id) ? repeating.has(id) : undefined) };
}

/** Clean and check a habit against the conflict rules (src/lib/rules). */
export const checkHabitForm = (f: HabitForm, opts: { resolve?: boolean } = {}): HabitCheck =>
	checkHabit(f, habitCtx(f), opts);

export function listHabits(accountId: string, opts: { archived?: boolean } = {}) {
	return db
		.select({
			id: habit.id,
			name: habit.name,
			direction: habit.direction,
			schedule: habit.schedule,
			cue: habit.cue,
			areaId: habit.areaId,
			archived: habit.archived,
			createdAt: habit.createdAt
		})
		.from(habit)
		.where(and(eq(habit.accountId, accountId), opts.archived ? undefined : eq(habit.archived, false)))
		.orderBy(asc(habit.sortOrder), asc(habit.name))
		.all()
		.map((h) => ({ ...h, schedule: h.schedule as ScheduleForm | null }));
}

export function getHabitForm(accountId: string, id: string): HabitForm | null {
	const h = db
		.select()
		.from(habit)
		.where(and(eq(habit.id, id), eq(habit.accountId, accountId)))
		.get();
	if (!h) return null;
	// Links to a habit that was deleted since are dropped, so the form still saves.
	const exists = (other: string | null | undefined) =>
		!!other &&
		!!db.select({ id: habit.id }).from(habit).where(and(eq(habit.id, other), eq(habit.accountId, accountId))).get();
	const cue = { ...emptyCue(), ...(h.cue ?? {}), range: h.cue?.range ?? null };
	if (cue.afterHabitId && !exists(cue.afterHabitId)) cue.afterHabitId = null;
	const ifThen = h.ifThen ?? { when: '', then: '', habitId: null };
	if (ifThen.habitId && !exists(ifThen.habitId)) ifThen.habitId = null;
	const variants = db
		.select()
		.from(variant)
		.where(eq(variant.habitId, id))
		.orderBy(asc(variant.sortOrder))
		.all();
	const slots = variants.length
		? db
				.select()
				.from(slot)
				.where(
					inArray(
						slot.variantId,
						variants.map((v) => v.id)
					)
				)
				.orderBy(asc(slot.sortOrder))
				.all()
		: [];
	return {
		name: h.name,
		direction: h.direction,
		notes: h.notes ?? '',
		startDate: h.startDate,
		schedule: h.schedule as ScheduleForm | null,
		cue,
		streakRule: h.streakRule as StreakRule,
		minimumCounts: h.minimumCounts,
		levels: h.levels ?? defaultLevels(),
		quickDone: h.quickDone,
		remind: h.remind,
		identityIds: db
			.select({ id: habitIdentity.identityId })
			.from(habitIdentity)
			.where(eq(habitIdentity.habitId, id))
			.all()
			.map((r) => r.id),
		ifThen,
		triggers: h.triggers ?? DEFAULT_TRIGGERS,
		reframe: h.reframe ?? '',
		bundle: h.bundle ?? { reward: '', strict: false },
		prep: h.prep ?? [],
		reward: h.reward ?? { celebrate: false, message: '', jar: null },
		cost: h.cost ?? null,
		limit: h.limit ? { ...h.limit, taper: h.limit.taper ? { floor: 0, ...h.limit.taper } : null } : null,
		progression: h.progression ?? null,
		areaId: h.areaId,
		unlogged: h.unlogged,
		variants: variants.map((v) => ({
			id: v.id,
			name: v.name,
			slots: slots
				.filter((s) => s.variantId === v.id)
				.map((s) => ({
					id: s.id,
					taskId: s.taskId,
					fillRule: s.fillRule as HabitForm['variants'][number]['slots'][number]['fillRule'],
					sets: s.sets,
					targets: s.targets ?? {},
					minTargets: s.minTargets ?? {},
					stretchTargets: s.stretchTargets ?? {}
				}))
		}))
	};
}

/** A Habit's links to other rows must point at this account's rows, and stacking can't loop. */
export function checkLinks(accountId: string, id: string | null, f: HabitForm): string | null {
	const others = db
		.select({ id: habit.id, cue: habit.cue, direction: habit.direction })
		.from(habit)
		.where(eq(habit.accountId, accountId))
		.all();
	const after = f.cue.afterHabitId;
	if (after) {
		if (!others.some((o) => o.id === after && o.direction === 'build') || after === id)
			return 'Pick another habit to stack after';
		const anchors = new Map(others.map((o) => [o.id, o.cue?.afterHabitId ?? null]));
		if (id && makesLoop(id, after, anchors)) return 'Stacking these habits would make a loop';
	}
	if (f.ifThen.habitId && !others.some((o) => o.id === f.ifThen.habitId && o.direction === 'build'))
		return 'Pick a build habit as the replacement';
	if (f.areaId && !db.select({ id: area.id }).from(area).where(and(eq(area.id, f.areaId), eq(area.accountId, accountId))).get())
		return 'Unknown area';
	if (f.identityIds.length) {
		const owned = db
			.select({ id: identity.id })
			.from(identity)
			.where(and(eq(identity.accountId, accountId), inArray(identity.id, f.identityIds)))
			.all();
		if (owned.length !== new Set(f.identityIds).size) return 'Unknown identity';
	}
	return null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Which days a schedule edit applies to: from today on (the past keeps its plan), or past days too. */
export type ScheduleApplies = 'today' | 'past';

interface Before {
	startDate: string;
	unlogged: 'missed' | 'ignore';
	schedule: unknown;
	earlierSchedules: EarlierSchedule[] | null;
}

/**
 * A schedule edit that applies from today on: the old schedule keeps the days up to yesterday,
 * so they stay as they were, whatever is logged later. One that applies to past days too (a
 * plan that was wrong from the start) counts every past day again with the new schedule.
 * Today's log is planned again either way while nothing is logged in it.
 */
function scheduleAfter(
	tx: Tx,
	id: string,
	before: Before,
	after: { startDate: string; schedule: unknown },
	applies: ScheduleApplies,
	today: string
): { earlierSchedules?: EarlierSchedule[] | null; settledThrough?: null } {
	if (!before.schedule || !after.schedule || sameSchedule(before.schedule, after.schedule)) {
		// Starting earlier: the earliest schedule covers the new days, from a start in time.
		const first = before.earlierSchedules?.[0];
		if (first && after.startDate < before.startDate)
			return { earlierSchedules: [{ ...first, schedule: scheduleStartBy(first.schedule, after.startDate) }, ...before.earlierSchedules!.slice(1)] };
		return {};
	}
	const untouched = tx
		.select({ id: occurrence.id, notes: occurrence.notes })
		.from(occurrence)
		.where(and(eq(occurrence.habitId, id), eq(occurrence.date, today), eq(occurrence.status, 'due')))
		.all()
		.filter((o) => !o.notes && !tx.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, o.id)).get());
	if (untouched.length) tx.delete(occurrence).where(inArray(occurrence.id, untouched.map((o) => o.id))).run();
	if (applies === 'past') return { earlierSchedules: null, settledThrough: null };
	return { earlierSchedules: keepEarlier(before.earlierSchedules, before.schedule as Schedule, after.startDate, today) };
}

/**
 * Misses written for days nobody logged follow the habit's settings. Switching to ignore them
 * takes them away; switching back, or starting earlier, counts them again from the start
 * (on the next settle). Starting later drops misses before the new start. A schedule edit
 * that applies to past days too counts them all again.
 */
function settledAfter(
	tx: Tx,
	id: string,
	before: { startDate: string; unlogged: 'missed' | 'ignore' },
	after: { startDate: string; unlogged: 'missed' | 'ignore' },
	recountAll = false
): { settledThrough?: null } {
	// A miss with nothing logged and no note in it is one the app wrote for an unlogged day.
	const unloggedMisses = (where: ReturnType<typeof and>) =>
		tx
			.select({ id: occurrence.id })
			.from(occurrence)
			.where(where)
			.all()
			.map((o) => o.id)
			.filter((oid) => !tx.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, oid)).get());
	const drop = (ids: string[]) => {
		if (ids.length) tx.delete(occurrence).where(inArray(occurrence.id, ids)).run();
	};
	if ((after.unlogged === 'ignore' && before.unlogged !== 'ignore') || recountAll)
		drop(unloggedMisses(and(eq(occurrence.habitId, id), eq(occurrence.status, 'missed'), isNull(occurrence.notes))));
	else if (after.startDate > before.startDate)
		drop(unloggedMisses(and(eq(occurrence.habitId, id), eq(occurrence.status, 'missed'), isNull(occurrence.notes), lt(occurrence.date, after.startDate))));
	return after.unlogged === 'missed' && (before.unlogged !== 'missed' || after.startDate < before.startDate || recountAll)
		? { settledThrough: null }
		: {};
}

/** Edits of a saved habit its history policies refuse (build or break, once something is logged). */
export function checkHabitEdit(accountId: string, id: string, f: HabitForm): string | null {
	const before = getHabitForm(accountId, id);
	if (!before) return null;
	// Guarded fields changed: only then is it worth asking whether anything is logged.
	const issues = checkHabitPast(before, f, true);
	return issues.length && habitLogged(id) ? issues[0].reason : null;
}

/**
 * Create or update a Habit with its Variants and Slots. Returns its id, or null if not found.
 * An edit its history policies refuse (switching build and break once logged) throws PastEditError.
 */
export function saveHabit(
	accountId: string,
	id: string | null,
	f: HabitForm,
	today: string = new Date().toISOString().slice(0, 10),
	opts: { scheduleApplies?: ScheduleApplies } = {}
): string | null {
	// Values that can't apply (Levels on a break habit, a reminder with no time) are cleared.
	f = checkHabitForm(f).form;
	const refused = id ? checkHabitEdit(accountId, id, f) : null;
	if (refused) throw new PastEditError(refused);
	let judgeAgain = false;
	const saved = db.transaction((tx) => {
		// A changed limit or taper applies from today, so past days keep the limit they had.
		if (f.limit) {
			const before = id
				? tx.select({ limit: habit.limit }).from(habit).where(eq(habit.id, id)).get()?.limit
				: null;
			const same =
				before &&
				before.max === f.limit.max &&
				before.period === f.limit.period &&
				JSON.stringify(before.taper ?? null) === JSON.stringify(f.limit.taper ?? null);
			f = { ...f, limit: { ...f.limit, start: same ? before.start : today } };
		}
		const habitId = id ?? randomUUID();
		const isBreak = f.direction === 'break';
		const cue = {
			time: f.cue.time || null,
			place: f.cue.place || null,
			afterHabitId: f.cue.afterHabitId,
			afterText: f.cue.afterHabitId ? null : f.cue.afterText || null,
			range: f.cue.range || null
		};
		const values = {
			name: f.name,
			direction: f.direction,
			notes: f.notes || null,
			startDate: f.startDate,
			schedule: isBreak ? null : f.schedule,
			cue: Object.values(cue).some(Boolean) ? cue : null,
			streakRule: f.streakRule,
			minimumCounts: f.minimumCounts,
			levels: f.levels.enabled ? f.levels : null,
			quickDone: f.quickDone,
			remind: f.remind,
			ifThen: isBreak && (f.ifThen.when || f.ifThen.then || f.ifThen.habitId) ? f.ifThen : null,
			triggers: isBreak ? f.triggers : null,
			reframe: f.reframe || null,
			bundle: f.bundle.reward ? f.bundle : null,
			prep: !isBreak && f.prep.length ? f.prep : null,
			reward: !isBreak && (f.reward.celebrate || f.reward.message || f.reward.jar) ? f.reward : null,
			cost: isBreak ? f.cost : null,
			limit: isBreak ? f.limit : null,
			progression: isBreak ? null : f.progression,
			areaId: f.areaId,
			unlogged: isBreak ? ('missed' as const) : (f.unlogged ?? 'missed')
		};
		if (id) {
			const owned = tx
				.select({
					id: habit.id,
					startDate: habit.startDate,
					unlogged: habit.unlogged,
					schedule: habit.schedule,
					earlierSchedules: habit.earlierSchedules,
					minimumCounts: habit.minimumCounts,
					levels: habit.levels
				})
				.from(habit)
				.where(and(eq(habit.id, id), eq(habit.accountId, accountId)))
				.get();
			if (!owned) return null;
			const sched = scheduleAfter(tx, id, owned, values, opts.scheduleApplies ?? 'today', today);
			const settled = settledAfter(tx, id, owned, values, sched.settledThrough === null);
			tx.update(habit).set({ ...values, ...sched, ...settled }).where(eq(habit.id, id)).run();
			// The rule for what counts changed: past logs are judged again by it.
			judgeAgain = owned.minimumCounts !== values.minimumCounts || !!owned.levels?.enabled !== !!values.levels?.enabled;
		} else {
			tx.insert(habit)
				.values({ id: habitId, accountId, ...values })
				.run();
		}

		tx.delete(habitIdentity).where(eq(habitIdentity.habitId, habitId)).run();
		for (const identityId of new Set(f.identityIds))
			tx.insert(habitIdentity).values({ habitId, identityId }).run();

		// Break habits have no Variants. Keep ids stable so past Occurrences still point at them.
		const variants = isBreak ? [] : f.variants;
		const variantIds = variants.map((v) => v.id);
		tx.delete(variant)
			.where(
				variantIds.length
					? and(eq(variant.habitId, habitId), notInArray(variant.id, variantIds))
					: eq(variant.habitId, habitId)
			)
			.run();
		variants.forEach((v, i) => {
			tx.insert(variant)
				.values({ id: v.id, habitId, name: v.name, sortOrder: i })
				.onConflictDoUpdate({ target: variant.id, set: { name: v.name, sortOrder: i } })
				.run();
			const slotIds = v.slots.map((s) => s.id);
			// Logs made against targets that change keep the ones they aimed for.
			const was = tx.select().from(slot).where(eq(slot.variantId, v.id)).all();
			const goal = (x: { taskId: string | null; sets: number | null; targets: unknown; minTargets: unknown; stretchTargets: unknown }) =>
				JSON.stringify([x.taskId, x.sets, x.targets ?? {}, x.minTargets ?? {}, x.stretchTargets ?? {}]);
			const changed = was.some((old) => {
				const now = v.slots.find((x) => x.id === old.id);
				return !now || goal(old) !== goal({ ...now, taskId: now.fillRule ? null : now.taskId, minTargets: now.minTargets, stretchTargets: now.stretchTargets });
			});
			if (changed) keepGoals(tx, [v.id]);
			tx.delete(slot)
				.where(
					slotIds.length
						? and(eq(slot.variantId, v.id), notInArray(slot.id, slotIds))
						: eq(slot.variantId, v.id)
				)
				.run();
			v.slots.forEach((s, j) => {
				const taskId = s.fillRule ? null : s.taskId;
				// Targets only for fields of the Slot's Task: a Task swapped out leaves none behind.
				const own = taskId
					? new Set(tx.select({ id: metric.id }).from(metric).where(and(eq(metric.taskId, taskId), eq(metric.archived, false))).all().map((m) => m.id))
					: null;
				const keep = (t: Record<string, number>) => (own ? Object.fromEntries(Object.entries(t ?? {}).filter(([k]) => own.has(k))) : (t ?? {}));
				const targets = keep(s.targets);
				const minTargets = keep(s.minTargets);
				const stretchTargets = keep(s.stretchTargets);
				const sv = {
					variantId: v.id,
					taskId,
					fillRule: s.fillRule,
					sets: s.sets,
					targets,
					minTargets: Object.keys(minTargets).length ? minTargets : null,
					stretchTargets: Object.keys(stretchTargets).length ? stretchTargets : null,
					sortOrder: j
				};
				tx.insert(slot)
					.values({ id: s.id, ...sv })
					.onConflictDoUpdate({ target: slot.id, set: sv })
					.run();
			});
		});
		return habitId;
	});
	if (saved && judgeAgain) rejudge(saved, today);
	return saved;
}

export function deleteHabit(accountId: string, id: string) {
	db.delete(habit)
		.where(and(eq(habit.id, id), eq(habit.accountId, accountId)))
		.run();
}

export function setHabitArchived(accountId: string, id: string, archived: boolean) {
	db.update(habit)
		.set({ archived })
		.where(and(eq(habit.id, id), eq(habit.accountId, accountId)))
		.run();
}

/**
 * A Habit form copied with fresh ids, for "copy one of my habits" and Duplicate.
 * Slots keep their Tasks, so the copy prefills from the same last values.
 */
export function copyHabitForm(f: HabitForm, newId: () => string = randomUUID): HabitForm {
	const variantIds = new Map(f.variants.map((v) => [v.id, newId()]));
	const map = (id: string) => variantIds.get(id) ?? id;
	let schedule = f.schedule;
	if (schedule) {
		switch (schedule.kind) {
			case 'weekly':
				schedule = { ...schedule, days: Object.fromEntries(Object.entries(schedule.days).map(([d, v]) => [d, map(v)])) };
				break;
			case 'frequency':
			case 'interval':
				schedule = { ...schedule, variantId: map(schedule.variantId) };
				break;
			case 'rotation':
				schedule = { ...schedule, order: schedule.order.map((o) => ({ ...o, variantId: map(o.variantId) })) };
		}
	}
	return {
		...structuredClone(f),
		name: `${f.name} (copy)`.slice(0, 120),
		schedule,
		variants: f.variants.map((v) => ({
			...structuredClone(v),
			id: variantIds.get(v.id)!,
			slots: v.slots.map((s) => ({ ...structuredClone(s), id: newId() }))
		}))
	};
}
