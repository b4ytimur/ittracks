import { randomUUID } from 'node:crypto';
import { and, asc, countDistinct, eq, inArray, isNull, max, notInArray } from 'drizzle-orm';
import { db } from '../db';
import { collection, collectionTask, entry, habit, metric, occurrence, slot, tag, task, taskTag, variant } from '../db/schema';
import type { TaskForm } from '$lib/forms';

export interface TaskSummary {
	id: string;
	name: string;
	areaId: string | null;
	archived: boolean;
	createdAt: Date;
	tags: { name: string; level: number }[];
}

/** Top-level Tasks (not sub-tasks) with their Tags, for the Library and pickers. Archived ones only on request. */
export function listTasks(accountId: string, opts: { archived?: boolean } = {}): TaskSummary[] {
	const tasks = db
		.select({ id: task.id, name: task.name, areaId: task.areaId, archived: task.archived, createdAt: task.createdAt })
		.from(task)
		.where(
			and(
				eq(task.accountId, accountId),
				isNull(task.parentTaskId),
				opts.archived ? undefined : eq(task.archived, false)
			)
		)
		.orderBy(asc(task.name))
		.all();
	const tagRows = tasks.length
		? db
				.select({ taskId: taskTag.taskId, name: tag.name, level: taskTag.level })
				.from(taskTag)
				.innerJoin(tag, eq(taskTag.tagId, tag.id))
				.where(
					inArray(
						taskTag.taskId,
						tasks.map((t) => t.id)
					)
				)
				.all()
		: [];
	return tasks.map((t) => ({
		...t,
		tags: tagRows
			.filter((r) => r.taskId === t.id)
			.map(({ name, level }) => ({ name, level }))
			.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
	}));
}

export function listTagNames(accountId: string): string[] {
	return db
		.select({ name: tag.name })
		.from(tag)
		.where(eq(tag.accountId, accountId))
		.orderBy(asc(tag.name))
		.all()
		.map((t) => t.name);
}

/** A Task as the editor needs it, or null if it is not this account's. */
export function getTaskForm(accountId: string, id: string): TaskForm | null {
	const t = db
		.select()
		.from(task)
		.where(and(eq(task.id, id), eq(task.accountId, accountId), isNull(task.parentTaskId)))
		.get();
	if (!t) return null;
	return {
		name: t.name,
		notes: t.notes ?? '',
		restTimerEnabled: t.restTimerEnabled,
		restTimerSeconds: t.restTimerSeconds,
		tags: listTasks(accountId, { archived: true }).find((x) => x.id === id)?.tags ?? [],
		metrics: db
			.select()
			.from(metric)
			.where(eq(metric.taskId, id))
			.orderBy(asc(metric.sortOrder))
			.all()
			.map((m) => ({
				id: m.id,
				name: m.name,
				type: m.type,
				unit: m.unit ?? '',
				repeats: m.repeats,
				choices: m.choices ?? [],
				prefill: m.prefill,
				step: m.step,
				required: m.required,
				quick: m.quick,
				long: m.long,
				starter: m.starter ?? '',
				prompts: m.prompts ?? [],
				promptOrder: m.promptOrder,
				scores: m.scores ?? {}
			})),
		subtasks: db
			.select({ id: task.id, name: task.name })
			.from(task)
			.where(eq(task.parentTaskId, id))
			.orderBy(asc(task.sortOrder))
			.all(),
		areaId: t.areaId,
		collectionIds: db
			.select({ id: collectionTask.collectionId })
			.from(collectionTask)
			.where(eq(collectionTask.taskId, id))
			.all()
			.map((r) => r.id)
	};
}

/** Create or update a Task with its Tags, Metrics and sub-tasks. Returns its id. */
export function saveTask(
	accountId: string,
	id: string | null,
	f: TaskForm,
	newId: string = randomUUID()
): string | null {
	return db.transaction((tx) => {
		const taskId = id ?? newId;
		if (id) {
			const owned = tx
				.select({ id: task.id })
				.from(task)
				.where(and(eq(task.id, id), eq(task.accountId, accountId)))
				.get();
			if (!owned) return null;
			tx.update(task)
				.set({
					name: f.name,
					notes: f.notes || null,
					restTimerEnabled: f.restTimerEnabled,
					restTimerSeconds: f.restTimerSeconds,
					areaId: f.areaId
				})
				.where(eq(task.id, id))
				.run();
		} else {
			tx.insert(task)
				.values({
					id: taskId,
					accountId,
					name: f.name,
					notes: f.notes || null,
					restTimerEnabled: f.restTimerEnabled,
					restTimerSeconds: f.restTimerSeconds,
					areaId: f.areaId
				})
				.run();
		}

		// Hand-picked Collections of this account only; smart ones fill themselves.
		tx.delete(collectionTask).where(eq(collectionTask.taskId, taskId)).run();
		const picked = f.collectionIds.length
			? tx
					.select({ id: collection.id })
					.from(collection)
					.where(
						and(
							eq(collection.accountId, accountId),
							inArray(collection.id, f.collectionIds),
							isNull(collection.filter)
						)
					)
					.all()
			: [];
		for (const c of picked) tx.insert(collectionTask).values({ collectionId: c.id, taskId }).run();

		// Tags: create any new names, then replace this Task's links.
		tx.delete(taskTag).where(eq(taskTag.taskId, taskId)).run();
		const seen = new Set<string>();
		for (const t of f.tags) {
			const key = t.name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			let tagRow = tx
				.select()
				.from(tag)
				.where(and(eq(tag.accountId, accountId), eq(tag.name, t.name)))
				.get();
			if (!tagRow) {
				tagRow = { id: randomUUID(), accountId, name: t.name };
				tx.insert(tag).values(tagRow).run();
			}
			tx.insert(taskTag).values({ taskId, tagId: tagRow.id, level: t.level }).run();
		}

		// Metrics: keep ids stable so past Entries still line up.
		const metricIds = f.metrics.map((m) => m.id);
		tx.delete(metric)
			.where(
				metricIds.length
					? and(eq(metric.taskId, taskId), notInArray(metric.id, metricIds))
					: eq(metric.taskId, taskId)
			)
			.run();
		f.metrics.forEach((m, i) => {
			const values = {
				name: m.name,
				type: m.type,
				unit: m.unit || null,
				repeats: m.repeats,
				choices: m.type === 'choice' ? m.choices : null,
				sortOrder: i,
				prefill: m.prefill,
				step: m.step,
				required: m.required,
				quick: m.quick,
				long: m.long,
				starter: m.starter || null,
				prompts: m.prompts.length ? m.prompts : null,
				promptOrder: m.promptOrder,
				scores: Object.keys(m.scores).length ? m.scores : null
			};
			tx.insert(metric)
				.values({ id: m.id, taskId, ...values })
				.onConflictDoUpdate({ target: metric.id, set: values })
				.run();
		});

		// Sub-tasks, one level deep.
		const subIds = f.subtasks.map((s) => s.id);
		tx.delete(task)
			.where(
				subIds.length
					? and(eq(task.parentTaskId, taskId), notInArray(task.id, subIds))
					: eq(task.parentTaskId, taskId)
			)
			.run();
		f.subtasks.forEach((s, i) => {
			tx.insert(task)
				.values({ id: s.id, accountId, name: s.name, parentTaskId: taskId, sortOrder: i })
				.onConflictDoUpdate({ target: task.id, set: { name: s.name, sortOrder: i } })
				.run();
		});

		return taskId;
	});
}

export function deleteTask(accountId: string, id: string) {
	db.transaction((tx) => {
		tx.delete(task).where(and(eq(task.parentTaskId, id), eq(task.accountId, accountId))).run();
		tx.delete(task).where(and(eq(task.id, id), eq(task.accountId, accountId))).run();
	});
}

export function setTaskArchived(accountId: string, id: string, archived: boolean) {
	db.update(task)
		.set({ archived })
		.where(and(eq(task.id, id), eq(task.accountId, accountId), isNull(task.parentTaskId)))
		.run();
}

/** Copy a Task with its Tags, Metrics, sub-tasks and Collections. Returns the new id. */
export function duplicateTask(accountId: string, id: string): string | null {
	const f = getTaskForm(accountId, id);
	if (!f) return null;
	return saveTask(accountId, null, {
		...f,
		name: `${f.name} (copy)`.slice(0, 120),
		metrics: f.metrics.map((m) => ({ ...m, id: randomUUID() })),
		subtasks: f.subtasks.map((s) => ({ ...s, id: randomUUID() }))
	});
}

export interface TaskUsage {
	habits: { id: string; name: string }[];
	lastLogged: string | null;
	timesLogged: number;
}

/** Which habits use each Task, when it was last logged and how often. */
export function taskUsage(accountId: string): Map<string, TaskUsage> {
	const out = new Map<string, TaskUsage>();
	const get = (id: string) => out.get(id) ?? out.set(id, { habits: [], lastLogged: null, timesLogged: 0 }).get(id)!;
	const uses = db
		.select({ taskId: slot.taskId, habitId: habit.id, name: habit.name })
		.from(slot)
		.innerJoin(variant, eq(slot.variantId, variant.id))
		.innerJoin(habit, eq(variant.habitId, habit.id))
		.where(eq(habit.accountId, accountId))
		.all();
	for (const u of uses) {
		if (!u.taskId) continue;
		const g = get(u.taskId);
		if (!g.habits.some((h) => h.id === u.habitId)) g.habits.push({ id: u.habitId, name: u.name });
	}
	const logs = db
		.select({ taskId: entry.taskId, last: max(occurrence.date), n: countDistinct(occurrence.id) })
		.from(entry)
		.innerJoin(occurrence, eq(entry.occurrenceId, occurrence.id))
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(and(eq(habit.accountId, accountId), eq(occurrence.status, 'done')))
		.groupBy(entry.taskId)
		.all();
	for (const l of logs) {
		const g = get(l.taskId);
		g.lastLogged = l.last;
		g.timesLogged = l.n;
	}
	return out;
}
