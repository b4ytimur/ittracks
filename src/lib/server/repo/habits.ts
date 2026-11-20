import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '../db';
import { habit, slot, variant } from '../db/schema';
import type { HabitForm, ScheduleForm } from '$lib/forms';

export function listHabits(accountId: string) {
	return db
		.select({ id: habit.id, name: habit.name, direction: habit.direction, schedule: habit.schedule })
		.from(habit)
		.where(and(eq(habit.accountId, accountId), eq(habit.archived, false)))
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
					targets: s.targets ?? {}
				}))
		}))
	};
}

/** Create or update a Habit with its Variants and Slots. Returns its id, or null if not found. */
export function saveHabit(accountId: string, id: string | null, f: HabitForm): string | null {
	return db.transaction((tx) => {
		const habitId = id ?? randomUUID();
		const isBreak = f.direction === 'break';
		const values = {
			name: f.name,
			direction: f.direction,
			notes: f.notes || null,
			startDate: f.startDate,
			schedule: isBreak ? null : f.schedule
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
