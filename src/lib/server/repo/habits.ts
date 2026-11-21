import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '../db';
import { area, habit, habitIdentity, identity, metric, slot, variant } from '../db/schema';
import {
	DEFAULT_TRIGGERS,
	defaultLevels,
	emptyCue,
	type HabitForm,
	type ScheduleForm
} from '$lib/forms';
import { makesLoop } from '$lib/engine/stack';
import type { StreakRule } from '$lib/engine/streak';
import { checkHabit, type HabitCheck, type HabitCtx } from '$lib/rules/habit';

/** What the habit rules need to know from the database. */
export function habitCtx(f: HabitForm): HabitCtx {
	const ids = [...new Set(f.variants.flatMap((v) => v.slots.map((s) => s.taskId)).filter((x): x is string => !!x))];
	const repeating = new Set(
		ids.length
			? db
					.select({ taskId: metric.taskId })
					.from(metric)
					.where(and(inArray(metric.taskId, ids), eq(metric.repeats, true)))
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
			archived: habit.archived
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

/** Create or update a Habit with its Variants and Slots. Returns its id, or null if not found. */
export function saveHabit(
	accountId: string,
	id: string | null,
	f: HabitForm,
	today: string = new Date().toISOString().slice(0, 10)
): string | null {
	// Values that can't apply (Levels on a break habit, a reminder with no time) are cleared.
	f = checkHabitForm(f).form;
	return db.transaction((tx) => {
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
			areaId: f.areaId
		};
		if (id) {
			const owned = tx
				.select({ id: habit.id })
				.from(habit)
				.where(and(eq(habit.id, id), eq(habit.accountId, accountId)))
				.get();
			if (!owned) return null;
			tx.update(habit).set(values).where(eq(habit.id, id)).run();
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
			tx.delete(slot)
				.where(
					slotIds.length
						? and(eq(slot.variantId, v.id), notInArray(slot.id, slotIds))
						: eq(slot.variantId, v.id)
				)
				.run();
			v.slots.forEach((s, j) => {
				const sv = {
					variantId: v.id,
					taskId: s.fillRule ? null : s.taskId,
					fillRule: s.fillRule,
					sets: s.sets,
					targets: s.targets,
					minTargets: Object.keys(s.minTargets).length ? s.minTargets : null,
					stretchTargets: Object.keys(s.stretchTargets).length ? s.stretchTargets : null,
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
