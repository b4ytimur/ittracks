// One change to a Task at a time, checked against what the page that sends it had.
import { z } from 'zod';
import { firstError, taskForm, type TaskForm } from '$lib/forms';
import { checkTask } from '$lib/rules/task';
import type { UnitChoice } from '$lib/units';
import { emit } from './core/events';
import { PastEditError } from './history';
import { listAreas } from './repo/areas';
import { checkTaskEdit, checkTaskLinks, getTaskForm, saveTask } from './repo/tasks';
import { withTaskSnapshot } from './task-snapshot';
import type { Actor } from './core/actor';

export const taskPatch = z.object({
	set: z.record(z.string(), z.unknown()),
	was: z.record(z.string(), z.unknown()),
	/** What a unit change does to values already logged. */
	units: z.record(z.string().uuid(), z.enum(['convert', 'relabel'])).default({}),
	/** It touches what is logged: keep what it replaces, for its Undo. */
	keep: z.boolean().default(false)
});
export type TaskPatch = z.infer<typeof taskPatch>;
export type TaskPatchResult = { form: TaskForm; undo?: string } | { error: string; status: 400 | 404 } | { moved: Record<string, unknown>; form: TaskForm };

const ordered = (v: unknown): string =>
	JSON.stringify(v ?? null, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

export function patchTask(actor: Actor, id: string, p: TaskPatch): TaskPatchResult {
	const accountId = actor.accountId;
	const now = getTaskForm(accountId, id);
	if (!now) return { error: 'No such Task', status: 404 };
	const keys = Object.keys(p.set).filter((k) => k in taskForm.shape);
	if (!keys.length) return { error: 'Nothing to change', status: 400 };
	const cur = now as Record<string, unknown>;
	const moved = keys.filter((k) => ordered(cur[k]) !== ordered(p.was[k]) && ordered(cur[k]) !== ordered(p.set[k]));
	if (moved.length) return { moved: Object.fromEntries(moved.map((k) => [k, cur[k]])), form: now };
	const parsed = taskForm.safeParse({ ...now, ...Object.fromEntries(keys.map((k) => [k, p.set[k]])) });
	if (!parsed.success) return { error: firstError(parsed.error), status: 400 };
	const checked = checkTask(parsed.data);
	const form = checked.form;
	if (form.areaId && !listAreas(accountId).some((a) => a.id === form.areaId)) form.areaId = null;
	const past = checkTaskEdit(accountId, id, form, p.units as Record<string, UnitChoice>);
	const problem = checked.errors[0]?.reason ?? checkTaskLinks(accountId, id, form) ?? past?.errors[0]?.reason;
	if (problem) return { error: problem, status: 400 };
	const save = () => saveTask(accountId, id, form, undefined, { units: p.units as Record<string, UnitChoice> });
	try {
		const undo = p.keep ? withTaskSnapshot(accountId, id, save).undo : (save(), undefined);
		// Readers of older values learn which unit they were in.
		for (const u of past?.units ?? [])
			emit(actor, 'metric.unit_changed', {
				data: { taskId: id, metricId: u.metricId, from: u.from, to: u.to, converted: u.choice === 'convert', factor: u.choice === 'convert' && u.change.kind === 'convertible' ? u.change.factor : 1 }
			});
		return { form: getTaskForm(accountId, id)!, undo };
	} catch (e) {
		if (e instanceof PastEditError) return { error: e.message, status: 400 };
		throw e;
	}
}
