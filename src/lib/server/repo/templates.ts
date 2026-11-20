// Adding a template: answer its questions, reuse Tasks already in the Library, then save.
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { metric, task } from '../db/schema';
import { applyAnswers, fromTemplate, type TemplateAnswers, type TemplateFile } from '$lib/template';
import { habitForm } from '$lib/forms';
import { saveTask } from './tasks';
import { saveHabit } from './habits';
import { identityFor } from './identities';
import { areaByName } from './areas';

export interface AddResult {
	habitId: string;
	name: string;
	created: number;
	reused: number;
}

/**
 * Create a Habit from a template. With `reuse`, a template Task whose name matches one in
 * the Library (any case) links to that Task, and its Metrics match by name and type.
 */
export function addTemplate(
	accountId: string,
	tpl: TemplateFile,
	opts: { today: string; answers?: TemplateAnswers; reuse?: boolean }
): AddResult | { error: string } {
	const filled = applyAnswers(tpl, opts.answers ?? {});
	const { tasks, habit, identities } = fromTemplate(filled, opts.today);
	if (!habitForm.safeParse(habit).success) return { error: 'The template has an invalid habit or schedule.' };

	const taskMap = new Map<string, string>();
	const metricMap = new Map<string, string>();
	const toCreate: typeof tasks = [];
	const library = opts.reuse
		? db
				.select({ id: task.id, name: task.name })
				.from(task)
				.where(and(eq(task.accountId, accountId), isNull(task.parentTaskId), eq(task.archived, false)))
				.all()
		: [];
	for (const t of tasks) {
		const match = library.find((l) => l.name.trim().toLowerCase() === t.form.name.trim().toLowerCase());
		if (!match) {
			toCreate.push(t);
			continue;
		}
		taskMap.set(t.id, match.id);
		const theirs = db.select().from(metric).where(eq(metric.taskId, match.id)).all();
		for (const m of t.form.metrics) {
			const same = theirs.find((x) => x.name.toLowerCase() === m.name.toLowerCase() && x.type === m.type);
			if (same) metricMap.set(m.id, same.id);
		}
	}
	// Only Metrics that matched carry their targets over to a reused Task.
	const remap = (r: Record<string, number>) =>
		Object.fromEntries(Object.entries(r).filter(([k]) => metricMap.has(k)).map(([k, v]) => [metricMap.get(k)!, v]));
	for (const v of habit.variants)
		for (const s of v.slots) {
			if (s.taskId && taskMap.has(s.taskId)) {
				s.taskId = taskMap.get(s.taskId)!;
				s.targets = remap(s.targets);
				s.minTargets = remap(s.minTargets);
				s.stretchTargets = remap(s.stretchTargets);
			}
		}

	const areaId = areaByName(accountId, tpl.meta?.area);
	for (const t of toCreate) saveTask(accountId, null, { ...t.form, areaId }, t.id);
	habit.areaId = areaId;
	habit.identityIds = identities.map((statement) => identityFor(accountId, statement));
	const habitId = saveHabit(accountId, null, habit, opts.today)!;
	return { habitId, name: habit.name, created: toCreate.length, reused: taskMap.size };
}
