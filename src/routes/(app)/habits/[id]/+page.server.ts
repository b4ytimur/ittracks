import { error, fail, redirect } from '@sveltejs/kit';
import { firstError, habitForm, type HabitForm } from '$lib/forms';
import { deleteHabit, getHabitForm, saveHabit } from '$lib/server/repo/habits';
import { listTagNames, listTasks } from '$lib/server/repo/tasks';
import type { Actions, PageServerLoad } from './$types';

const today = () => new Date().toISOString().slice(0, 10);

const blank = (): HabitForm => ({
	name: '',
	direction: 'build',
	notes: '',
	startDate: today(),
	variants: [],
	schedule: null
});

export const load: PageServerLoad = ({ locals, params }) => {
	const accountId = locals.account!.id;
	const isNew = params.id === 'new';
	const form = isNew ? blank() : getHabitForm(accountId, params.id);
	if (!form) error(404, 'Habit not found');
	return {
		id: params.id,
		isNew,
		habit: form,
		tasks: listTasks(accountId).map(({ id, name }) => ({ id, name })),
		tags: listTagNames(accountId)
	};
};

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		let json: unknown;
		try {
			json = JSON.parse(String((await request.formData()).get('payload')));
		} catch {
			return fail(400, { error: 'Could not read the form.' });
		}
		const parsed = habitForm.safeParse(json);
		if (!parsed.success) return fail(400, { error: firstError(parsed.error) });
		const id = saveHabit(locals.account!.id, params.id === 'new' ? null : params.id, parsed.data);
		if (!id) error(404, 'Habit not found');
		redirect(303, '/habits');
	},
	delete: ({ locals, params }) => {
		deleteHabit(locals.account!.id, params.id);
		redirect(303, '/habits');
	}
};
