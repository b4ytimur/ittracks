import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { collection, collectionTask, task, type CollectionFilter } from '../db/schema';
import type { TaskSummary } from './tasks';

export interface CollectionRow {
	id: string;
	name: string;
	parentId: string | null;
	filter: CollectionFilter | null;
	/** Hand-picked members; empty for smart Collections. */
	taskIds: string[];
}

export function listCollections(accountId: string): CollectionRow[] {
	const rows = db
		.select()
		.from(collection)
		.where(eq(collection.accountId, accountId))
		.orderBy(asc(collection.sortOrder), asc(collection.name))
		.all();
	const members = rows.length
		? db
				.select()
				.from(collectionTask)
				.where(inArray(collectionTask.collectionId, rows.map((r) => r.id)))
				.all()
		: [];
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		parentId: r.parentId,
		filter: r.filter ?? null,
		taskIds: members.filter((m) => m.collectionId === r.id).map((m) => m.taskId)
	}));
}

/** Does a Task match a smart Collection's filter? Every part that is set must match. */
export function matchesFilter(t: TaskSummary, f: CollectionFilter): boolean {
	const tags = new Set(t.tags.map((g) => g.name.toLowerCase()));
	if (f.tags.some((g) => !tags.has(g.toLowerCase()))) return false;
	if (f.areaId && t.areaId !== f.areaId) return false;
	if (f.text && !t.name.toLowerCase().includes(f.text.toLowerCase())) return false;
	return f.tags.length > 0 || !!f.areaId || !!f.text;
}

/** Task ids in a Collection, including its sub-Collections. */
export function collectionTasks(c: CollectionRow, all: CollectionRow[], tasks: TaskSummary[]): Set<string> {
	const ids = new Set<string>();
	const add = (x: CollectionRow) => {
		if (x.filter) for (const t of tasks) if (matchesFilter(t, x.filter)) ids.add(t.id);
		for (const id of x.taskIds) ids.add(id);
	};
	add(c);
	for (const child of all.filter((x) => x.parentId === c.id)) add(child);
	return ids;
}

export interface CollectionInput {
	name: string;
	parentId: string | null;
	filter: CollectionFilter | null;
	taskIds: string[];
}

/** Create or update a Collection. Nesting is one level deep: a parent can't itself have a parent. */
export function saveCollection(accountId: string, id: string | null, f: CollectionInput): string | null {
	return db.transaction((tx) => {
		let parentId = f.parentId;
		if (parentId) {
			const p = tx
				.select()
				.from(collection)
				.where(and(eq(collection.id, parentId), eq(collection.accountId, accountId), isNull(collection.parentId)))
				.get();
			if (!p || p.id === id) parentId = null;
		}
		// A Collection with children can't move under another.
		if (id && parentId && tx.select({ id: collection.id }).from(collection).where(eq(collection.parentId, id)).get())
			parentId = null;
		const cid = id ?? randomUUID();
		const values = { name: f.name, parentId, filter: f.filter };
		if (id) {
			const owned = tx
				.select({ id: collection.id })
				.from(collection)
				.where(and(eq(collection.id, id), eq(collection.accountId, accountId)))
				.get();
			if (!owned) return null;
			tx.update(collection).set(values).where(eq(collection.id, id)).run();
		} else tx.insert(collection).values({ id: cid, accountId, ...values }).run();
		tx.delete(collectionTask).where(eq(collectionTask.collectionId, cid)).run();
		const owned = !f.filter && f.taskIds.length
			? tx
					.select({ id: task.id })
					.from(task)
					.where(and(eq(task.accountId, accountId), inArray(task.id, [...new Set(f.taskIds)])))
					.all()
			: [];
		for (const t of owned) tx.insert(collectionTask).values({ collectionId: cid, taskId: t.id }).run();
		return cid;
	});
}

export function deleteCollection(accountId: string, id: string) {
	db.transaction((tx) => {
		tx.update(collection)
			.set({ parentId: null })
			.where(and(eq(collection.parentId, id), eq(collection.accountId, accountId)))
			.run();
		tx.delete(collection).where(and(eq(collection.id, id), eq(collection.accountId, accountId))).run();
	});
}
