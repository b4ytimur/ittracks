import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { db } from '../db';
import { metric, tag, task, taskTag } from '../db/schema';
import type { TaskForm } from '$lib/forms';

export interface TaskSummary {
	id: string;
	name: string;
	tags: { name: string; level: number }[];
}

/** Top-level Tasks (not sub-tasks) with their Tags, for the Library and pickers. */
export function listTasks(accountId: string): TaskSummary[] {
	const tasks = db
		.select({ id: task.id, name: task.name })
		.from(task)
		.where(and(eq(task.accountId, accountId), isNull(task.parentTaskId)))
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
		tags: listTasks(accountId).find((x) => x.id === id)?.tags ?? [],
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
				choices: m.choices ?? []
			})),
		subtasks: db
			.select({ id: task.id, name: task.name })
			.from(task)
			.where(eq(task.parentTaskId, id))
			.orderBy(asc(task.sortOrder))
			.all()
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
					restTimerSeconds: f.restTimerSeconds
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
					restTimerSeconds: f.restTimerSeconds
				})
				.run();
		}

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
				sortOrder: i
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
