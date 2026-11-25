// Adding a template: answer its questions, reuse Tasks already in the Library, then save the
// habit and the habits inside it, all or nothing.
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { metric, task } from '../db/schema';
import { applyAnswers, fromTemplate, type TemplateAnswers, type TemplateFile } from '$lib/template';
import { habitForm, type HabitForm, type TaskForm } from '$lib/forms';
import { MAX_DEPTH } from '$lib/engine/parts';
import { saveTask, taskUsage } from './tasks';
import { checkHabitForm, checkLinks, saveHabit } from './habits';
import { checkTask } from '$lib/rules/task';
import { identityFor } from './identities';
import { areaFor } from './areas';
import { trash } from '../trash';

export interface AddResult {
	habitId: string;
	name: string;
	created: number;
	reused: number;
	/** Habits added inside it. */
	inside: number;
	/** Everything it made, for its Undo. */
	made: { habits: string[]; tasks: string[] };
}

/** Where adding a template lands: Habits, saying what was added (and the view it suggests). */
export const addedPath = (r: AddResult, view: string | null) =>
	`/habits?added=${encodeURIComponent(r.name)}&created=${r.created}&reused=${r.reused}&inside=${r.inside}${view ? `&view=${encodeURIComponent(view)}` : ''}`;

/** Thrown inside the save to undo everything written so far. */
class Refused extends Error {}

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
	const { tasks, habit, identities, children } = fromTemplate(filled, opts.today);
	if (opts.remind && filled.habit.remind && (habit.cue.time || habit.cue.range)) habit.remind = true;
	// Each habit inside comes after the one it sits in, so it can be put there once that one is saved.
	const before = new Set<string | null>([null]);
	for (const c of children) {
		if (!before.has(c.parent)) return { error: `The template can't be added: "${c.habit.name}" sits in a habit the template doesn't have before it.` };
		before.add(c.key);
	}
	const habits = [habit, ...children.map((c) => c.habit)];
	if (habits.some((h) => !habitForm.safeParse(h).success)) return { error: 'The template has an invalid habit or schedule.' };
	// A shared template can't bring in options that block each other. The habits inside are
	// checked once they know the habit they sit in, as they are saved.
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
	for (const v of habits.flatMap((h) => h.variants))
		for (const s of v.slots) {
			if (s.taskId && taskMap.has(s.taskId)) {
				s.taskId = taskMap.get(s.taskId)!;
				s.targets = remap(s.targets);
				s.minTargets = remap(s.minTargets);
				s.stretchTargets = remap(s.stretchTargets);
			}
		}

	// Tasks inside new Tasks: a reused one is pointed at, with only its matched fields' targets.
	for (const t of toCreate)
		t.form.parts = t.form.parts.map((p) =>
			p.kind === 'task' && taskMap.has(p.taskId)
				? { ...p, taskId: taskMap.get(p.taskId)!, targets: remap(p.targets), minTargets: remap(p.minTargets), stretchTargets: remap(p.stretchTargets) }
				: p
		);
	// A Task is created after the Tasks inside it. A file with Tasks inside each other in a loop is refused.
	const ordered: typeof toCreate = [];
	const pending = new Map(toCreate.map((t) => [t.id, t]));
	while (pending.size) {
		const ready = [...pending.values()].filter((t) => t.form.parts.every((p) => p.kind === 'step' || !pending.has(p.taskId) || p.taskId === t.id));
		if (!ready.length || ready.some((t) => t.form.parts.some((p) => p.kind === 'task' && p.taskId === t.id)))
			return { error: 'The template has Tasks inside each other in a loop.' };
		for (const t of ready) {
			ordered.push(t);
			pending.delete(t.id);
		}
	}
	if (ordered.some((t) => t.form.parts.some((p) => p.kind === 'task' && depthOf(ordered, p.taskId) >= MAX_DEPTH)))
		return { error: `The template has Tasks inside each other more than ${MAX_DEPTH} levels deep.` };

	const addAreas = opts.addAreas ?? true;
	try {
		return db.transaction(() => {
			const areaId = areaFor(accountId, tpl.meta?.area, addAreas);
			const taskArea = new Map(tpl.tasks.map((t, i) => [tasks[i]?.id, t.area]));
			for (const t of ordered) {
				const own = taskArea.get(t.id);
				saveTask(accountId, null, { ...t.form, areaId: own ? areaFor(accountId, own, addAreas) : areaId }, t.id);
			}
			// The habits inside go in the same Area as the habit, each one after the habit it sits in.
			const save = (h: HabitForm, statements: string[], parentId: string | null) => {
				h.areaId = areaId;
				h.parentId = parentId;
				h.identityIds = statements.map((statement) => identityFor(accountId, statement));
				if (parentId) {
					const conflict = checkHabitForm(h).errors[0];
					if (conflict) throw new Refused(`"${h.name}" has options that conflict: ${conflict.reason}.`);
					const refused = checkLinks(accountId, null, h);
					if (refused) throw new Refused(`"${h.name}" can't go inside its habit: ${refused}.`);
				}
				return saveHabit(accountId, null, h, opts.today)!;
			};
			const habitId = save(habit, identities, null);
			const saved = new Map<string | null, string>([[null, habitId]]);
			for (const c of children) saved.set(c.key, save(c.habit, c.identities, saved.get(c.parent)!));
			return { habitId, name: habit.name, created: toCreate.length, reused: taskMap.size, inside: children.length, made: { habits: [...saved.values()], tasks: ordered.map((t) => t.id) } };
		});
	} catch (e) {
		if (e instanceof Refused) return { error: `The template can't be added: ${e.message}` };
		throw e;
	}
}

/** How many levels of parts sit below a new Task of a template (reused Tasks count as none). */
function depthOf(tasks: { id: string; form: TaskForm }[], id: string, seen = new Set<string>()): number {
	const t = tasks.find((x) => x.id === id);
	if (!t || seen.has(id)) return 0;
	return Math.max(0, ...t.form.parts.map((p) => (p.kind === 'task' ? 1 + depthOf(tasks, p.taskId, new Set([...seen, id])) : 0)));
}

/** Read the add form shared by the Gallery and file import: answers, name, and the choices under the preview. */
export function readAddForm(f: FormData, tpl: TemplateFile) {
	const answers: TemplateAnswers = {};
	// Added as it comes: its questions keep their defaults.
	const plain = f.get('plain') === 'on';
	for (const q of plain ? [] : tpl.questions) {
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
		remind: plain ? tpl.habit.remind : f.get('remind') === 'on',
		addAreas: f.get('addAreas') === 'on'
	};
}

/** Take back what adding a template made. Tasks something else uses by now stay. */
export function unadd(accountId: string, made: AddResult['made'], today: string): boolean {
	// The habits inside go before the one they are in.
	const gone = [...made.habits].reverse().map((id) => !!trash(accountId, 'habit', id, today));
	const usage = taskUsage(accountId);
	const ours = new Set(made.habits);
	for (const id of [...made.tasks].reverse()) if (!usage.get(id)?.habits.some((h) => !ours.has(h.id))) trash(accountId, 'task', id, today);
	return gone.at(-1) ?? false;
}
