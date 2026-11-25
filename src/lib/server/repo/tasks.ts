import { randomUUID } from 'node:crypto';
import { and, asc, countDistinct, eq, inArray, isNull, max } from 'drizzle-orm';
import { db } from '../db';
import { collection, collectionTask, entry, habit, metric, occurrence, slot, tag, task, taskPart, taskTag, variant } from '../db/schema';
import { name as nameRule, type PartForm, type TaskForm } from '$lib/forms';
import { checkParts, edgesOf } from '$lib/engine/parts';
import { descendants } from '$lib/engine/tree';
import { checkTaskPast, type TaskPast } from '$lib/rules/task';
import type { UnitChoice } from '$lib/units';
import { getUnits } from '../settings';
import { convertMetricValues, dropTargets, PastEditError, taskLogged } from '../history';
import { activeOptions, keepEarlierScores, mergeOptions, type ChoiceOption, type Scores } from '$lib/options';
import { addDays } from '$lib/engine/dates';
import { userToday } from '../today';
export { PastEditError };

/** An empty list is stored as no list. */
const nullIfEmpty = <T>(list: T[] | null | undefined): T[] | null => (list?.length ? list : null);

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
				isNull(task.deleteAfter),
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
		rowOne: t.rowOne,
		rowMany: t.rowMany,
		betweenName: t.betweenName,
		tags: listTasks(accountId, { archived: true }).find((x) => x.id === id)?.tags ?? [],
		metrics: db
			.select()
			.from(metric)
			.where(and(eq(metric.taskId, id), eq(metric.archived, false)))
			.orderBy(asc(metric.sortOrder))
			.all()
			.map((m) => ({
				id: m.id,
				name: m.name,
				type: m.type,
				unit: m.unit ?? '',
				repeats: m.repeats,
				times: m.times,
				better: m.better,
				// Archived options stay with past logs; the editor offers the rest.
				choices: activeOptions(m.choices).map(({ id, name }) => ({ id, name })),
				prefill: m.prefill,
				step: m.step,
				required: m.required,
				quick: m.quick,
				long: m.long,
				starter: m.starter ?? '',
				prompts: m.prompts ?? [],
				promptOrder: m.promptOrder,
				scores: Object.fromEntries(Object.entries(m.scores ?? {}).filter(([k]) => activeOptions(m.choices).some((o) => o.id === k)))
			})),
		parts: partsOfTask(id),
		areaId: t.areaId,
		collectionIds: db
			.select({ id: collectionTask.collectionId })
			.from(collectionTask)
			.where(eq(collectionTask.taskId, id))
			.all()
			.map((r) => r.id)
	};
}

/** A Task's parts as the editor shows them: its own steps by name, Library Tasks with sets and targets. */
function partsOfTask(id: string, q: Pick<typeof db, 'select'> = db): PartForm[] {
	return q
		.select({ p: taskPart, child: { name: task.name, parentTaskId: task.parentTaskId } })
		.from(taskPart)
		.innerJoin(task, eq(taskPart.childTaskId, task.id))
		.where(and(eq(taskPart.taskId, id), eq(taskPart.archived, false)))
		.orderBy(asc(taskPart.sortOrder))
		.all()
		.map(({ p, child }): PartForm =>
			child.parentTaskId === id && p.id === p.childTaskId
				? { kind: 'step', id: p.id, name: child.name }
				: {
						kind: 'task',
						id: p.id,
						taskId: p.childTaskId,
						sets: p.sets,
						targets: p.targets ?? {},
						minTargets: p.minTargets ?? {},
						stretchTargets: p.stretchTargets ?? {}
					}
		);
}

/**
 * What's wrong with these parts for this Task, or null: each Library Task must be this
 * account's (not another Task's private step), and none may put the Task inside itself or
 * nest deeper than the cap (engine/parts.ts).
 */
export function checkTaskLinks(accountId: string, id: string | null, f: Pick<TaskForm, 'parts'>): string | null {
	const childIds = f.parts.flatMap((p) => (p.kind === 'task' ? [p.taskId] : []));
	if (!childIds.length) return null;
	const mine = new Map(
		db
			.select({ id: task.id, name: task.name, parentTaskId: task.parentTaskId })
			.from(task)
			.where(and(eq(task.accountId, accountId), inArray(task.id, childIds)))
			.all()
			.map((t) => [t.id, t])
	);
	for (const c of childIds) if (!mine.get(c) || mine.get(c)!.parentTaskId) return 'Pick a Task from your Library';
	if (!id) return null;
	const others = db
		.select({ taskId: taskPart.taskId, childTaskId: taskPart.childTaskId })
		.from(taskPart)
		.innerJoin(task, eq(taskPart.taskId, task.id))
		.where(and(eq(task.accountId, accountId), eq(taskPart.archived, false)))
		.all();
	return checkParts(others, id, childIds, (c) => mine.get(c)?.name ?? 'That Task');
}

export interface PartChoice {
	id: string;
	name: string;
	/** Fields of its own, for the part's targets. */
	metrics: { id: string; name: string; type: string; unit: string | null; repeats: boolean }[];
	/** Parts of its own: sets on it are rounds unless it has per-set fields. */
	hasParts: boolean;
}

/**
 * Library Tasks that can go inside `selfId`: every active one except itself and any that
 * already has it somewhere inside (which would make a loop).
 */
export function libraryForParts(accountId: string, selfId: string | null): PartChoice[] {
	const tasks = listTasks(accountId);
	const edges = edgesOf(
		db
			.select({ taskId: taskPart.taskId, childTaskId: taskPart.childTaskId })
			.from(taskPart)
			.innerJoin(task, eq(taskPart.taskId, task.id))
			.where(and(eq(task.accountId, accountId), eq(taskPart.archived, false)))
			.all()
	);
	const ok = tasks.filter((t) => !selfId || (t.id !== selfId && !descendants(edges, t.id).has(selfId)));
	const metrics = ok.length
		? db
				.select({ id: metric.id, taskId: metric.taskId, name: metric.name, type: metric.type, unit: metric.unit, repeats: metric.repeats })
				.from(metric)
				.where(and(inArray(metric.taskId, ok.map((t) => t.id)), eq(metric.archived, false)))
				.orderBy(asc(metric.sortOrder))
				.all()
		: [];
	const parents = new Set(edges.map((e) => e.parentId));
	return ok.map((t) => ({
		id: t.id,
		name: t.name,
		metrics: metrics.filter((m) => m.taskId === t.id).map(({ id, name, type, unit, repeats }) => ({ id, name, type, unit, repeats })),
		hasParts: parents.has(t.id)
	}));
}

/**
 * What an edit of a saved Task would do to its history: refused edits, unit changes that
 * need a choice, and what gets archived. Null when the Task isn't this account's.
 */
export function checkTaskEdit(accountId: string, id: string, f: TaskForm, units: Record<string, UnitChoice> = {}): TaskPast | null {
	const before = getTaskForm(accountId, id);
	return before ? checkTaskPast(before, f, taskLogged(id), getUnits(accountId), units) : null;
}

/**
 * Create or update a Task with its Tags, Metrics and parts. Returns its id. An edit follows
 * the history policies: a removed field or part with logs is archived, a unit change on a
 * field with logs converts its past values or keeps them (`units`, per Metric id), and a
 * locked change throws PastEditError.
 */
export function saveTask(
	accountId: string,
	id: string | null,
	f: TaskForm,
	newId: string = randomUUID(),
	opts: { units?: Record<string, UnitChoice> } = {}
): string | null {
	return db.transaction((tx) => {
		const taskId = id ?? newId;
		let past: TaskPast | null = null;
		if (id) {
			const owned = tx
				.select({ id: task.id })
				.from(task)
				.where(and(eq(task.id, id), eq(task.accountId, accountId), isNull(task.parentTaskId)))
				.get();
			if (!owned) return null;
			past = checkTaskEdit(accountId, id, f, opts.units);
			if (past?.errors[0]) throw new PastEditError(past.errors[0].reason);
			tx.update(task)
				.set({
					name: f.name,
					notes: f.notes || null,
					restTimerEnabled: f.restTimerEnabled,
					restTimerSeconds: f.restTimerSeconds,
					rowOne: f.rowOne,
					rowMany: f.rowMany,
					betweenName: f.betweenName,
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
					rowOne: f.rowOne,
					rowMany: f.rowMany,
					betweenName: f.betweenName,
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
				tagRow = tx.insert(tag).values({ id: randomUUID(), accountId, name: t.name }).returning().get();
			}
			tx.insert(taskTag).values({ taskId, tagId: tagRow.id, level: t.level }).run();
		}

		// Metrics: keep ids stable so past Entries still line up. A removed one with logged
		// values is archived (History and Stats keep it); one never logged is deleted.
		const goneMetrics = past?.removed.metrics ?? { archive: [], drop: [] };
		if (goneMetrics.drop.length) tx.delete(metric).where(and(eq(metric.taskId, taskId), inArray(metric.id, goneMetrics.drop))).run();
		if (goneMetrics.archive.length) {
			tx.update(metric).set({ archived: true }).where(and(eq(metric.taskId, taskId), inArray(metric.id, goneMetrics.archive))).run();
			dropTargets(tx, accountId, goneMetrics.archive);
		}
		// Past values follow a unit change the way the user chose: converted, or kept as they are.
		for (const u of past?.units ?? [])
			if (u.choice === 'convert' && u.change.kind === 'convertible') convertMetricValues(tx, accountId, taskId, u.metricId, u.change.factor);
		// Ids only of this Task's own Metrics, or new ones: never another Task's field.
		const foreignMetrics = new Set(
			f.metrics.length
				? tx
						.select({ id: metric.id, taskId: metric.taskId })
						.from(metric)
						.where(inArray(metric.id, f.metrics.map((m) => m.id)))
						.all()
						.filter((r) => r.taskId !== taskId)
						.map((r) => r.id)
				: []
		);
		// Choice options: removed ones a log picked are archived. Numbers past logs used are kept
		// with the last day they applied, when an edit changes them.
		const saved = new Map(
			tx
				.select({ id: metric.id, choices: metric.choices, scores: metric.scores, earlierScores: metric.earlierScores })
				.from(metric)
				.where(eq(metric.taskId, taskId))
				.all()
				.map((r) => [r.id, r])
		);
		const logged = id ? taskLogged(taskId, tx) : null;
		const yesterday = logged ? addDays(userToday(accountId), -1) : '';
		f.metrics.forEach((m, i) => {
			if (foreignMetrics.has(m.id)) return;
			const was = saved.get(m.id);
			const choices = m.type === 'choice' ? mergeOptions(was?.choices, m.choices, past?.options[m.id]?.archive ?? []) : null;
			const scores = scoresToSave(m.scores, choices, was?.scores);
			const values = {
				name: m.name,
				type: m.type,
				unit: m.unit || null,
				repeats: m.repeats,
				times: m.times,
				better: m.better,
				choices,
				sortOrder: i,
				prefill: m.prefill,
				step: m.step,
				required: m.required,
				quick: m.quick,
				long: m.long,
				starter: m.starter || null,
				prompts: m.prompts.length ? m.prompts : null,
				promptOrder: m.promptOrder,
				scores: Object.keys(scores).length ? scores : null,
				earlierScores: nullIfEmpty(was && logged?.metrics.has(m.id) ? keepEarlierScores(was.scores, was.earlierScores, scores, yesterday) : was?.earlierScores),
				archived: false
			};
			tx.insert(metric)
				.values({ id: m.id, taskId, ...values })
				.onConflictDoUpdate({ target: metric.id, set: values })
				.run();
		});

		// Parts: steps and Library Tasks inside this one. A removed part with anything logged under
		// it is archived, so past logs keep their place; one never logged is deleted. A part whose
		// Task was swapped for another counts as removed, and the new one gets a new id.
		const loggedParts = id ? taskLogged(taskId, tx).parts : new Set<string>();
		const existing = new Map(tx.select().from(taskPart).where(eq(taskPart.taskId, taskId)).all().map((p) => [p.id, p]));
		const foreignParts = new Set(
			f.parts.length
				? tx
						.select({ id: taskPart.id, taskId: taskPart.taskId })
						.from(taskPart)
						.where(inArray(taskPart.id, f.parts.map((p) => p.id)))
						.all()
						.filter((r) => r.taskId !== taskId)
						.map((r) => r.id)
				: []
		);
		const parts = f.parts.map((p) => {
			const was = existing.get(p.id);
			const child = p.kind === 'step' ? p.id : p.taskId;
			return was && was.childTaskId !== child ? { ...p, id: randomUUID() } : foreignParts.has(p.id) ? { ...p, id: randomUUID() } : p;
		});
		const keptIds = new Set(parts.map((p) => p.id));
		const gone = [...existing.values()].filter((p) => !keptIds.has(p.id) && !p.archived);
		const archive = gone.filter((p) => loggedParts.has(p.id));
		const drop = gone.filter((p) => !loggedParts.has(p.id));
		if (archive.length) tx.update(taskPart).set({ archived: true }).where(inArray(taskPart.id, archive.map((p) => p.id))).run();
		if (drop.length) tx.delete(taskPart).where(inArray(taskPart.id, drop.map((p) => p.id))).run();
		// A step is its own Task row: archived or deleted with its part.
		const ownStep = (p: { id: string; childTaskId: string }) => p.id === p.childTaskId;
		if (archive.some(ownStep)) tx.update(task).set({ archived: true }).where(and(eq(task.parentTaskId, taskId), inArray(task.id, archive.filter(ownStep).map((p) => p.childTaskId)))).run();
		if (drop.some(ownStep)) tx.delete(task).where(and(eq(task.parentTaskId, taskId), inArray(task.id, drop.filter(ownStep).map((p) => p.childTaskId)))).run();
		// Step ids only of this Task's own steps, or new ones: never another Task's row.
		const stepIds = parts.flatMap((p) => (p.kind === 'step' ? [p.id] : []));
		const foreignSteps = new Set(
			stepIds.length
				? tx
						.select({ id: task.id, parent: task.parentTaskId })
						.from(task)
						.where(inArray(task.id, stepIds))
						.all()
						.filter((r) => r.parent !== taskId)
						.map((r) => r.id)
				: []
		);
		parts.forEach((p, i) => {
			if (p.kind === 'step') {
				if (foreignSteps.has(p.id)) return;
				tx.insert(task)
					.values({ id: p.id, accountId, name: p.name, parentTaskId: taskId, sortOrder: i })
					.onConflictDoUpdate({ target: task.id, set: { name: p.name, sortOrder: i, archived: false } })
					.run();
			}
			const row = {
				taskId,
				childTaskId: p.kind === 'step' ? p.id : p.taskId,
				sets: p.kind === 'task' ? p.sets : null,
				targets: p.kind === 'task' && Object.keys(p.targets).length ? p.targets : null,
				minTargets: p.kind === 'task' && Object.keys(p.minTargets).length ? p.minTargets : null,
				stretchTargets: p.kind === 'task' && Object.keys(p.stretchTargets).length ? p.stretchTargets : null,
				sortOrder: i,
				archived: false
			};
			tx.insert(taskPart)
				.values({ id: p.id, ...row })
				.onConflictDoUpdate({ target: taskPart.id, set: row })
				.run();
		});

		return taskId;
	});
}

/**
 * The numbers to save for a Choice: the editor's, plus those of archived options, which past
 * logs still read. Numbers off means off for every option.
 */
function scoresToSave(edited: Scores, choices: ChoiceOption[] | null, saved: Scores | null | undefined): Scores {
	if (!choices || !Object.keys(edited).length) return {};
	const archived = choices.filter((o) => o.archived && typeof saved?.[o.id] === 'number').map((o) => [o.id, saved![o.id]]);
	const active = Object.entries(edited).filter(([k, n]) => Number.isFinite(n) && choices.some((o) => o.id === k && !o.archived));
	return Object.fromEntries([...archived, ...active]);
}

/** Delete a Task with its own steps. Where it sat inside other Tasks, those parts go too. */
export function deleteTask(accountId: string, id: string) {
	db.transaction((tx) => {
		tx.delete(task).where(and(eq(task.parentTaskId, id), eq(task.accountId, accountId))).run();
		tx.delete(task).where(and(eq(task.id, id), eq(task.accountId, accountId))).run();
	});
}

/** Archive or bring back a Library Task. False when there is no such Task. */
export function setTaskArchived(accountId: string, id: string, archived: boolean): boolean {
	const r = db
		.update(task)
		.set(archived ? { archived } : { archived, deleteAfter: null })
		.where(and(eq(task.id, id), eq(task.accountId, accountId), isNull(task.parentTaskId)))
		.run();
	return r.changes > 0;
}

/** Rename a Library Task in place. Logs point at the Task, not its name, so history is untouched. */
export function renameTask(accountId: string, id: string, value: string): { error: string } | { name: string } {
	const parsed = nameRule.safeParse(value);
	if (!parsed.success) return { error: parsed.error.issues[0].message };
	const r = db
		.update(task)
		.set({ name: parsed.data })
		.where(and(eq(task.id, id), eq(task.accountId, accountId), isNull(task.parentTaskId)))
		.run();
	return r.changes ? { name: parsed.data } : { error: 'No such Task' };
}

/** Copy a Task with its Tags, Metrics, parts and Collections. Returns the new id. Library Tasks inside it are shared, not copied. */
export function duplicateTask(accountId: string, id: string): string | null {
	const f = getTaskForm(accountId, id);
	if (!f) return null;
	return saveTask(accountId, null, {
		...f,
		name: `${f.name} (copy)`.slice(0, 120),
		metrics: f.metrics.map((m) => ({ ...m, id: randomUUID() })),
		parts: f.parts.map((p) => ({ ...p, id: randomUUID() }))
	});
}

export interface TaskUsage {
	/** Habits that use it in a Slot, or through a Task it sits inside. */
	habits: { id: string; name: string }[];
	/** Tasks it sits inside. */
	inside: { id: string; name: string }[];
	lastLogged: string | null;
	timesLogged: number;
}

/** Which habits use each Task (directly or inside another Task), what it sits in, when it was last logged and how often. */
export function taskUsage(accountId: string): Map<string, TaskUsage> {
	const out = new Map<string, TaskUsage>();
	const get = (id: string) => out.get(id) ?? out.set(id, { habits: [], inside: [], lastLogged: null, timesLogged: 0 }).get(id)!;
	const parts = db
		.select({ taskId: taskPart.taskId, childTaskId: taskPart.childTaskId, name: task.name })
		.from(taskPart)
		.innerJoin(task, eq(taskPart.taskId, task.id))
		.where(and(eq(task.accountId, accountId), eq(taskPart.archived, false)))
		.all();
	for (const p of parts) {
		const g = get(p.childTaskId);
		if (!g.inside.some((x) => x.id === p.taskId)) g.inside.push({ id: p.taskId, name: p.name });
	}
	const edges = edgesOf(parts);
	const uses = db
		.select({ taskId: slot.taskId, habitId: habit.id, name: habit.name })
		.from(slot)
		.innerJoin(variant, eq(slot.variantId, variant.id))
		.innerJoin(habit, eq(variant.habitId, habit.id))
		.where(eq(habit.accountId, accountId))
		.all();
	for (const u of uses) {
		if (!u.taskId) continue;
		for (const id of [u.taskId, ...descendants(edges, u.taskId)]) {
			const g = get(id);
			if (!g.habits.some((h) => h.id === u.habitId)) g.habits.push({ id: u.habitId, name: u.name });
		}
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
