// Adding a template: answer its questions, reuse Tasks already in the Library, then save.
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { metric, task } from '../db/schema';
import { applyAnswers, fromTemplate, type TemplateAnswers, type TemplateFile } from '$lib/template';
import { habitForm } from '$lib/forms';
import { saveTask } from './tasks';
import { checkHabitForm, saveHabit } from './habits';
import { checkTask } from '$lib/rules/task';
import { identityFor } from './identities';
import { areaFor } from './areas';

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
	opts: {
		today: string;
		answers?: TemplateAnswers;
		reuse?: boolean;
		/** Turn on the reminder the template suggests (it needs a time or part of the day). */
		remind?: boolean;
		/** Add the template's Areas that you don't have yet (default: on). Off: only use Areas you have. */
		addAreas?: boolean;
	}
): AddResult | { error: string } {
	const filled = applyAnswers(tpl, opts.answers ?? {});
	const { tasks, habit, identities } = fromTemplate(filled, opts.today);
	if (opts.remind && filled.habit.remind && (habit.cue.time || habit.cue.range)) habit.remind = true;
	if (!habitForm.safeParse(habit).success) return { error: 'The template has an invalid habit or schedule.' };
	// A shared template can't bring in options that block each other.
	const conflict = [...tasks.flatMap((t) => checkTask(t.form).errors), ...checkHabitForm(habit).errors][0];
	if (conflict) return { error: `The template has options that conflict: ${conflict.reason}.` };

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
		const theirs = db.select().from(metric).where(and(eq(metric.taskId, match.id), eq(metric.archived, false))).all();
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

	const addAreas = opts.addAreas ?? true;
	const areaId = areaFor(accountId, tpl.meta?.area, addAreas);
	const taskArea = new Map(tpl.tasks.map((t, i) => [tasks[i]?.id, t.area]));
	for (const t of toCreate) {
		const own = taskArea.get(t.id);
		saveTask(accountId, null, { ...t.form, areaId: own ? areaFor(accountId, own, addAreas) : areaId }, t.id);
	}
	habit.areaId = areaId;
	habit.identityIds = identities.map((statement) => identityFor(accountId, statement));
	const habitId = saveHabit(accountId, null, habit, opts.today)!;
	return { habitId, name: habit.name, created: toCreate.length, reused: taskMap.size };
}

/** Read the add form shared by the Gallery and file import: answers, name, and the choices under the preview. */
export function readAddForm(f: FormData, tpl: TemplateFile) {
	const answers: TemplateAnswers = {};
	for (const q of tpl.questions) {
		const name = `q_${q.key}`;
		if (q.kind === 'days') answers[q.key] = f.getAll(name).map(Number).filter((d) => Number.isInteger(d));
		else if (q.kind === 'number') {
			const n = Number(f.get(name));
			if (f.get(name) !== '' && f.get(name) !== null && Number.isFinite(n)) answers[q.key] = n;
		} else answers[q.key] = String(f.get(name) ?? '');
	}
	const named = structuredClone(tpl);
	const name = String(f.get('name') ?? '').trim().slice(0, 120);
	if (name) named.habit.name = name;
	return {
		tpl: named,
		answers,
		reuse: f.get('separate') !== 'on',
		remind: f.get('remind') === 'on',
		addAreas: f.get('addAreas') === 'on'
	};
}
