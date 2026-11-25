import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lt, notInArray } from 'drizzle-orm';
import { db } from '../db';
import { area, entry, habit, habitIdentity, identity, metric, occurrence, slot, taskPart, variant } from '../db/schema';
import {
	DEFAULT_TRIGGERS,
	defaultLevels,
	emptyCue,
	type HabitForm,
	type ScheduleForm
} from '$lib/forms';
import { makesLoop } from '$lib/engine/stack';
import { keepEarlier, sameSchedule, scheduleStartBy, startMovedBack, type EarlierSchedule } from '$lib/engine/unlogged';
import { isFollow, isGroup, type Schedule } from '$lib/engine/schedule';
import { fitFollow, standaloneSchedule } from '$lib/engine/follow';
import { keepParent, makesCycle } from '$lib/engine/tree';
import { keepGoals, rejudge } from '../progress';
import type { StreakRule } from '$lib/engine/streak';
import { checkHabit, checkHabitPast, removedTriggers, type HabitCheck, type HabitCtx } from '$lib/rules/habit';
import { feelingsUsed, habitLogged, PastEditError } from '../history';
import { activeOptions, mergeOptions } from '$lib/options';
import { mapSchedule } from '$lib/template';

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
	const withParts = new Set(
		ids.length
			? db
					.select({ taskId: taskPart.taskId })
					.from(taskPart)
					.where(and(inArray(taskPart.taskId, ids), eq(taskPart.archived, false)))
					.all()
					.map((r) => r.taskId)
			: []
	);
	return {
		taskRepeats: (id) => (ids.includes(id) ? repeating.has(id) : undefined),
		taskHasParts: (id) => (ids.includes(id) ? withParts.has(id) : undefined)
	};
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
			createdAt: habit.createdAt,
			parentId: habit.parentId
		})
		.from(habit)
		.where(and(eq(habit.accountId, accountId), isNull(habit.deleteAfter), opts.archived ? undefined : eq(habit.archived, false)))
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
		// Archived feelings stay with past slips; the editor offers the rest.
		triggers: activeOptions(h.triggers ?? DEFAULT_TRIGGERS).map(({ id, name }) => ({ id, name })),
		reframe: h.reframe ?? '',
		bundle: h.bundle ?? { reward: '', strict: false },
		prep: h.prep ?? [],
		reward: h.reward ?? { celebrate: false, message: '', jar: null },
		cost: h.cost ?? null,
		limit: h.limit ? { ...h.limit, taper: h.limit.taper ? { floor: 0, ...h.limit.taper } : null } : null,
		progression: h.progression ?? null,
		areaId: h.areaId,
		parentId: h.parentId && exists(h.parentId) ? h.parentId : null,
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
		.select({ id: habit.id, cue: habit.cue, direction: habit.direction, schedule: habit.schedule, parentId: habit.parentId, archived: habit.archived })
		.from(habit)
		.where(eq(habit.accountId, accountId))
		.all();
	const parent = f.parentId ? others.find((o) => o.id === f.parentId) : undefined;
	if (f.parentId) {
		// A group, or a routine: a habit with its own schedule and no Tasks of its own.
		if (!parent || parent.direction !== 'build' || !parent.schedule) return 'Pick a group or a routine to put this habit in';
		if (!isGroup(parent.schedule as Schedule) && hasSlots(parent.id))
			return 'That habit has Tasks of its own, so it can’t hold habits yet. Pick a group or a habit with no Tasks';
		if (parent.archived && others.find((o) => o.id === id)?.parentId !== f.parentId) return 'That habit is archived. Pick another one';
		if (id && makesCycle(others, id, f.parentId)) return "A habit can't sit inside itself or a habit inside it";
		// A routine's Done marks what is inside it, and a group can't be marked: it is judged.
		if (isGroup(f.schedule) && !isGroup(parent.schedule as Schedule)) return 'A group can only sit inside another group for now';
	}
	if (isFollow(f.schedule)) {
		if (!parent || isGroup(parent.schedule as Schedule | null))
			return 'A habit can only follow a routine it sits in. Put it in a routine, or give it a schedule of its own';
		const theirs = new Set(db.select({ id: variant.id }).from(variant).where(eq(variant.habitId, parent.id)).all().map((v) => v.id));
		if (f.schedule.on && !f.schedule.on.some((v) => theirs.has(v))) return `Pick at least one of the routine's Variants`;
	}
	// A routine's Tasks are the habits inside it, for now.
	if (id && f.variants.some((v) => v.slots.length) && !isGroup(f.schedule) && others.some((o) => o.parentId === id && o.direction === 'build'))
		return 'This habit has habits inside it, so it has no Tasks of its own for now. Put these Tasks in a habit inside it';
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
 * A habit with no past days yet (it starts today or later) has no old plan to keep, and a
 * schedule whose start only moved back with Started on is the same plan begun earlier.
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
	const changed = !!before.schedule && !!after.schedule && !sameSchedule(before.schedule, after.schedule);
	const movedBack = changed && startMovedBack(before.schedule, after.schedule, before.startDate, after.startDate);
	if (changed) {
		const untouched = tx
			.select({ id: occurrence.id, notes: occurrence.notes })
			.from(occurrence)
			.where(and(eq(occurrence.habitId, id), eq(occurrence.date, today), eq(occurrence.status, 'due')))
			.all()
			.filter((o) => !o.notes && !tx.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, o.id)).get());
		if (untouched.length) tx.delete(occurrence).where(inArray(occurrence.id, untouched.map((o) => o.id))).run();
	}
	// Starting earlier: the earliest schedule covers the new days, from a start in time.
	const earliest = (list: EarlierSchedule[] | null) =>
		list?.length && after.startDate < before.startDate
			? [{ ...list[0], schedule: scheduleStartBy(list[0].schedule, after.startDate) }, ...list.slice(1)]
			: list;
	if (!changed || movedBack) {
		const list = earliest(before.earlierSchedules);
		return list !== before.earlierSchedules ? { earlierSchedules: list } : {};
	}
	if (applies === 'past' || before.startDate >= today) return { earlierSchedules: null, settledThrough: null };
	const old = before.earlierSchedules?.length ? (before.schedule as Schedule) : scheduleStartBy(before.schedule as Schedule, after.startDate);
	return { earlierSchedules: keepEarlier(earliest(before.earlierSchedules), old, after.startDate, today) };
}

/**
 * Misses written for days nobody logged follow the habit's settings. Switching to ignore them
 * takes them away; switching back, or starting earlier, counts them again from the start
 * (on the next settle). Starting later drops misses before the new start. A schedule edit
 * that applies to past days too counts them all again.
 */
export function settledAfter(
	tx: Tx | typeof db,
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
	// A group's days are worked out from the habits inside it, so a habit's own logs can't become a group's.
	const wasGroup = isGroup(before.schedule);
	if (!wasGroup && isGroup(f.schedule) && habitLogged(id))
		return 'This habit has logs, and a group gets its days from the habits inside it. Make a new habit for the group instead';
	if (wasGroup && !isGroup(f.schedule) && db.select({ id: habit.id }).from(habit).where(eq(habit.parentId, id)).get())
		return 'Move the habits inside this group out of it first';
	// A group has no days of its own for the habits inside to follow.
	if (!wasGroup && isGroup(f.schedule) && followers(id).length)
		return 'Habits inside this one follow its schedule. Give them a schedule of their own first';
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
	// Following its routine: it logs one of its own Variants, paired only with the routine's.
	if (isFollow(f.schedule)) f = { ...f, schedule: fitFollow(f.schedule, f.variants.map((v) => v.id), f.parentId ? variantIdsOf(f.parentId) : undefined) };
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
			parentId: isBreak ? null : f.parentId,
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
					levels: habit.levels,
					triggers: habit.triggers,
					parentId: habit.parentId,
					earlierParents: habit.earlierParents
				})
				.from(habit)
				.where(and(eq(habit.id, id), eq(habit.accountId, accountId)))
				.get();
			if (!owned) return null;
			// A feeling removed after a slip used it is archived, so that slip keeps its word.
			if (isBreak) {
				const gone = removedTriggers({ triggers: activeOptions(owned.triggers) }, f, feelingsUsed(id, tx));
				values.triggers = mergeOptions(owned.triggers, f.triggers, gone.archive);
			}
			// Becoming a group, or a group becoming a habit: nothing logged by hand crosses over
			// (checkHabitEdit refuses that), so the days written for the old kind go.
			const kindChanged = isGroup(owned.schedule as Schedule | null) !== isGroup(values.schedule as Schedule | null);
			if (kindChanged) tx.delete(occurrence).where(eq(occurrence.habitId, id)).run();
			const sched = kindChanged
				? { earlierSchedules: null, settledThrough: null }
				: scheduleAfter(tx, id, owned, values, opts.scheduleApplies ?? 'today', today);
			const settled = settledAfter(tx, id, owned, values, sched.settledThrough === null);
			// Moving into or out of a group or routine applies from today on, like a move on the Habits list.
			const earlierParents = keepParent(owned.earlierParents, owned.parentId, values.parentId, owned.startDate, today);
			tx.update(habit).set({ ...values, ...sched, ...settled, earlierParents }).where(eq(habit.id, id)).run();
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
			// A Slot added or taken away changes the plan too: past logs keep the one they had.
			const changed =
				v.slots.some((x) => !was.some((old) => old.id === x.id)) ||
				was.some((old) => {
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
	const gone = db.select({ id: habit.id }).from(habit).where(and(eq(habit.id, id), eq(habit.accountId, accountId))).get();
	if (!gone) return;
	const days = daysOf(id);
	db.transaction((tx) => {
		// The habits inside move to the top level. One that followed this habit gets its days.
		for (const k of followers(id))
			tx.update(habit)
				.set({ schedule: standaloneSchedule(days, k.schedule as Extract<Schedule, { kind: 'follow' }>, k.startDate) })
				.where(eq(habit.id, k.id))
				.run();
		tx.delete(habit)
			.where(and(eq(habit.id, id), eq(habit.accountId, accountId)))
			.run();
	});
}

/** A habit's days as a schedule of its own: a routine that follows another one takes that one's days. */
function daysOf(id: string, depth = 0): Schedule | null {
	const h = db.select({ schedule: habit.schedule, parentId: habit.parentId, startDate: habit.startDate }).from(habit).where(eq(habit.id, id)).get();
	const s = (h?.schedule ?? null) as Schedule | null;
	if (!h || !isFollow(s)) return s;
	const above = h.parentId && depth < 20 ? daysOf(h.parentId, depth + 1) : null;
	return standaloneSchedule(above, s, h.startDate);
}

/** A habit's Variant ids. */
const variantIdsOf = (habitId: string) => db.select({ id: variant.id }).from(variant).where(eq(variant.habitId, habitId)).all().map((v) => v.id);

/** The habits inside this one that follow its schedule. */
const followers = (id: string) =>
	db
		.select({ id: habit.id, schedule: habit.schedule, startDate: habit.startDate })
		.from(habit)
		.where(eq(habit.parentId, id))
		.all()
		.filter((k) => isFollow(k.schedule as Schedule | null));

const hasSlots = (habitId: string) =>
	!!db.select({ id: slot.id }).from(slot).innerJoin(variant, eq(slot.variantId, variant.id)).where(eq(variant.habitId, habitId)).get();

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
	return {
		...structuredClone(f),
		name: `${f.name} (copy)`.slice(0, 120),
		schedule: mapSchedule(f.schedule, map),
		variants: f.variants.map((v) => ({
			...structuredClone(v),
			id: variantIds.get(v.id)!,
			slots: v.slots.map((s) => ({ ...structuredClone(s), id: newId() }))
		}))
	};
}
