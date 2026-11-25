// Undo for changes to a Task that touch what is logged: a unit converted, a field or a step with
// logs taken away. Only rows still as the change left them are put back.
import { and, eq, inArray, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { entry, metric, occurrence, slot, task, taskPart, undoSnapshot } from './db/schema';
import { taskLogged } from './history';

type Row = Record<string, unknown> & { id: string };
interface Rows {
	task: Row[];
	metric: Row[];
	taskPart: Row[];
	slot: Row[];
	entry: Row[];
	occurrence: Row[];
}
interface Snapshot {
	taskId: string;
	before: Rows;
	after: Rows;
}

function rowsOf(accountId: string, taskId: string): Rows {
	const tasks = db.select().from(task).where(and(eq(task.accountId, accountId), or(eq(task.id, taskId), eq(task.parentTaskId, taskId)))).all();
	const ids = tasks.map((t) => t.id);
	const entries = ids.length ? db.select().from(entry).where(inArray(entry.taskId, ids)).all() : [];
	const occ = [...new Set(entries.map((e) => e.occurrenceId))];
	// Targets kept with past logs sit on the day, a few hundred days at a time.
	const days: Row[] = [];
	for (let i = 0; i < occ.length; i += 500) days.push(...(db.select({ id: occurrence.id, goals: occurrence.goals }).from(occurrence).where(inArray(occurrence.id, occ.slice(i, i + 500))).all() as Row[]));
	return {
		task: tasks as Row[],
		metric: ids.length ? (db.select().from(metric).where(inArray(metric.taskId, ids)).all() as Row[]) : [],
		taskPart: db.select().from(taskPart).where(or(eq(taskPart.taskId, taskId), eq(taskPart.childTaskId, taskId))).all() as Row[],
		slot: db.select({ id: slot.id, targets: slot.targets, minTargets: slot.minTargets, stretchTargets: slot.stretchTargets }).from(slot).where(eq(slot.taskId, taskId)).all() as Row[],
		entry: entries.map((e) => ({ id: e.id, values: e.values })) as Row[],
		occurrence: days
	};
}

const plain = (r: unknown) => JSON.parse(JSON.stringify(r ?? null));
const same = (a: unknown, b: unknown) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));
const revive = (r: Row): Row => ({ ...r, ...Object.fromEntries(['createdAt', 'deleteAfter'].flatMap((k) => (typeof r[k] === 'string' ? [[k, new Date(r[k] as string)]] : []))) });

export function withTaskSnapshot<T>(accountId: string, taskId: string, change: () => T): { result: T; undo: string } {
	const before = rowsOf(accountId, taskId);
	const result = change();
	const id = randomUUID();
	db.insert(undoSnapshot).values({ id, accountId, data: { taskId, before, after: rowsOf(accountId, taskId) } satisfies Snapshot }).run();
	return { result, undo: id };
}

/** Put it back. False when the Task was changed again since. */
export function restoreTaskSnapshot(accountId: string, id: string): boolean {
	const row = db.select().from(undoSnapshot).where(and(eq(undoSnapshot.id, id), eq(undoSnapshot.accountId, accountId))).get();
	const s = row?.data as Snapshot | undefined;
	if (!s?.taskId) return false;
	const now = rowsOf(accountId, s.taskId);
	const byId = (rows: Row[]) => new Map(rows.map((r) => [r.id, r]));
	const sorted = (rows: Row[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
	if (!now.task.length || (['task', 'metric', 'taskPart'] as const).some((k) => !same(sorted(now[k]), sorted(s.after[k])))) return false;
	// What came with the change goes with it, unless something was logged in it since: then it is archived, and the log keeps it.
	const logged = taskLogged(s.taskId);
	db.transaction((tx) => {
		const tables = { task, metric, taskPart } as const;
		for (const k of ['task', 'metric', 'taskPart'] as const) {
			const t = tables[k];
			for (const r of s.before[k]) tx.insert(t).values(revive(r) as never).onConflictDoUpdate({ target: t.id, set: revive(r) as never }).run();
			const keep = byId(s.before[k]);
			for (const r of now[k]) {
				if (keep.has(r.id)) continue;
				const used = k === 'metric' ? logged.metrics.has(r.id) : k === 'taskPart' ? logged.parts.has(r.id) : now.taskPart.some((p) => p.childTaskId === r.id && logged.parts.has(p.id));
				if (used) tx.update(t).set({ archived: true } as never).where(eq(t.id, r.id)).run();
				else tx.delete(t).where(eq(t.id, r.id)).run();
			}
		}
		for (const [k, t] of [['slot', slot], ['entry', entry], ['occurrence', occurrence]] as const) {
			const left = byId(s.after[k]);
			const cur = byId(now[k]);
			for (const r of s.before[k]) {
				const c = cur.get(r.id);
				if (!c || same(c, r) || !same(c, left.get(r.id))) continue;
				const { id: _, ...set } = r;
				tx.update(t).set(set as never).where(eq(t.id, r.id)).run();
			}
		}
		tx.delete(undoSnapshot).where(eq(undoSnapshot.id, id)).run();
	});
	return true;
}
