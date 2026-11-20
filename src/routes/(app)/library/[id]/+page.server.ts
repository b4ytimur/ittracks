import { error, fail, redirect } from '@sveltejs/kit';
import { firstError, taskForm, type TaskForm } from '$lib/forms';
import { deleteTask, getTaskForm, listTagNames, saveTask } from '$lib/server/repo/tasks';
import type { Actions, PageServerLoad } from './$types';

const blank = (): TaskForm => ({
	name: '',
	notes: '',
	restTimerEnabled: false,
	restTimerSeconds: 90,
	tags: [],
	metrics: [],
	subtasks: []
});

export const load: PageServerLoad = ({ locals, params }) => {
	const accountId = locals.account!.id;
	const isNew = params.id === 'new';
	const form = isNew ? blank() : getTaskForm(accountId, params.id);
	if (!form) error(404, 'Task not found');
	return { isNew, task: form, allTags: listTagNames(accountId) };
};

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const raw = (await request.formData()).get('payload');
		let json: unknown;
		try {
			json = JSON.parse(String(raw));
		} catch {
			return fail(400, { error: 'Could not read the form.' });
		}
		const parsed = taskForm.safeParse(json);
		if (!parsed.success) return fail(400, { error: firstError(parsed.error) });
		const id = saveTask(locals.account!.id, params.id === 'new' ? null : params.id, parsed.data);
		if (!id) error(404, 'Task not found');
		redirect(303, '/library');
	},
	delete: ({ locals, params }) => {
		deleteTask(locals.account!.id, params.id);
		redirect(303, '/library');
	}
};
