// Saving a habit or a Task the way its editor does: parse, conflict rules, links, history
// policies, then save. The editors' Save and setup (core/setup.ts) both call these, so a habit an
// assistant makes passes exactly the checks one made by hand does.
import type { z } from 'zod';
import { firstError, habitForm, taskForm, type TaskForm } from '$lib/forms';
import { checkTask } from '$lib/rules/task';
import type { UnitChoice } from '$lib/units';
import { checkHabitEdit, checkHabitForm, checkLinks, saveHabit, type ScheduleApplies } from '../repo/habits';
import { checkTaskEdit, checkTaskLinks, getTaskForm, saveTask } from '../repo/tasks';
import { listAreas } from '../repo/areas';
import { PastEditError } from '../history';
import { emit } from './events';
import type { Actor } from './actor';

export type Saved = { id: string; name: string; warnings: string[] };
/** Why it wasn't saved, in the editor's words (`zod`: the parse problems, for callers that list them). */
export type Refused = { error: string; zod?: z.ZodError; notFound?: true };

/** Save a habit form (id null: a new habit). */
export function saveHabitChecked(accountId: string, id: string | null, raw: unknown, today: string, applies: ScheduleApplies = 'today'): Saved | Refused {
	const parsed = habitForm.safeParse(raw);
	if (!parsed.success) return { error: firstError(parsed.error), zod: parsed.error };
	const checked = checkHabitForm(parsed.data);
	if (checked.errors[0]) return { error: checked.errors[0].reason };
	const links = checkLinks(accountId, id, parsed.data);
	if (links) return { error: links };
	// History policies: switching build and break once logged is refused.
	const refused = id ? checkHabitEdit(accountId, id, parsed.data) : null;
	if (refused) return { error: refused };
	let saved: string | null;
	try {
		saved = saveHabit(accountId, id, parsed.data, today, { scheduleApplies: applies });
	} catch (e) {
		if (e instanceof PastEditError) return { error: e.message };
		throw e;
	}
	if (!saved) return { error: 'Habit not found', notFound: true };
	return { id: saved, name: parsed.data.name, warnings: checked.warnings.map((w) => w.reason) };
}

/**
 * Save a Task form (id null: a new Library Task). `units` is the choice per field id for a unit
 * change on a field with values. Unit changes go into the event log as the actor's.
 */
export function saveTaskChecked(actor: Actor, id: string | null, raw: unknown, units: Record<string, UnitChoice> = {}): Saved | Refused {
	const accountId = actor.accountId;
	const parsed = taskForm.safeParse(raw);
	if (!parsed.success) return { error: firstError(parsed.error), zod: parsed.error };
	const checked = checkTask(parsed.data);
	if (checked.errors[0]) return { error: checked.errors[0].reason };
	const f: TaskForm = checked.form;
	if (f.areaId && !listAreas(accountId).some((a) => a.id === f.areaId)) f.areaId = null;
	const links = checkTaskLinks(accountId, id, f);
	if (links) return { error: links };
	// History policies: edits that would change what is already logged are refused or ask first.
	const before = id ? getTaskForm(accountId, id) : null;
	const past = id ? checkTaskEdit(accountId, id, f, units) : null;
	if (id && !past) return { error: 'Task not found', notFound: true };
	if (past?.errors[0]) return { error: past.errors[0].reason };
	let saved: string | null;
	try {
		saved = saveTask(accountId, id, f, undefined, { units });
	} catch (e) {
		if (e instanceof PastEditError) return { error: e.message };
		throw e;
	}
	if (!saved) return { error: 'Task not found', notFound: true };
	// The event log says when past values were converted or relabeled, so readers of older
	// value events know which unit they were in.
	for (const u of past?.units ?? [])
		emit(actor, 'metric.unit_changed', {
			data: { taskId: saved, metricId: u.metricId, from: u.from, to: u.to, converted: u.choice === 'convert', factor: u.choice === 'convert' && u.change.kind === 'convertible' ? u.change.factor : 1 }
		});
	const warnings = checked.warnings.map((w) => w.reason);
	const was = (mid: string) => before?.metrics.find((m) => m.id === mid)?.name ?? 'a field';
	for (const m of past?.removed.metrics.archive ?? []) warnings.push(`Field “${was(m)}” is taken off; it has logged values, so it is archived and they stay`);
	for (const m of past?.removed.metrics.drop ?? []) warnings.push(`Field “${was(m)}” is removed (nothing was logged in it)`);
	return { id: saved, name: f.name, warnings };
}
