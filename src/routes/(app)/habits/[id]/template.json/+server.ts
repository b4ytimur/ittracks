import { error, json } from '@sveltejs/kit';
import { getHabitForm, listHabits } from '$lib/server/repo/habits';
import { listIdentities } from '$lib/server/repo/identities';
import { getTaskForm } from '$lib/server/repo/tasks';
import { toTemplate } from '$lib/template';
import type { TaskForm } from '$lib/forms';
import type { RequestHandler } from './$types';

/** Download a Habit as a template file. */
export const GET: RequestHandler = ({ locals, params }) => {
	if (!locals.account) error(401);
	const habit = getHabitForm(locals.account.id, params.id);
	if (!habit) error(404);
	const tasks = new Map<string, TaskForm>();
	for (const v of habit.variants)
		for (const s of v.slots) {
			if (!s.taskId || tasks.has(s.taskId)) continue;
			const t = getTaskForm(locals.account.id, s.taskId);
			if (t) tasks.set(s.taskId, t);
		}
	const file = toTemplate(habit, tasks, {
		habits: new Map(listHabits(locals.account.id).map((h) => [h.id, h.name])),
		identities: new Map(listIdentities(locals.account.id).map((i) => [i.id, i.statement]))
	});
	const slug = habit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'habit';
	return json(file, {
		headers: { 'content-disposition': `attachment; filename="${slug}.ittracks.json"` }
	});
};
