import { fail } from '@sveltejs/kit';
import { listHabits, saveHabit } from '$lib/server/repo/habits';
import { saveTask } from '$lib/server/repo/tasks';
import { identityFor } from '$lib/server/repo/identities';
import { todayIn } from '$lib/server/today';
import { fromTemplate, templateFile } from '$lib/template';
import { habitForm } from '$lib/forms';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({ habits: listHabits(locals.account!.id) });

export const actions: Actions = {
	/** Create a Habit and its Tasks from a template file. */
	import: async ({ request, locals, cookies }) => {
		const file = (await request.formData()).get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose a template file.' });
		if (file.size > 1_000_000) return fail(400, { error: 'That file is too large for a template.' });
		let parsed;
		try {
			parsed = templateFile.safeParse(JSON.parse(await file.text()));
		} catch {
			return fail(400, { error: 'That file is not valid JSON.' });
		}
		if (!parsed.success) return fail(400, { error: 'That file is not an ittracks template.' });

		const { tasks, habit, identities } = fromTemplate(parsed.data, todayIn(cookies.get('tz')));
		if (!habitForm.safeParse(habit).success)
			return fail(400, { error: 'The template has an invalid habit or schedule.' });
		const accountId = locals.account!.id;
		for (const t of tasks) saveTask(accountId, null, t.form, t.id);
		habit.identityIds = identities.map((statement) => identityFor(accountId, statement));
		saveHabit(accountId, null, habit, todayIn(cookies.get('tz')));
		return { imported: habit.name, taskCount: tasks.length };
	}
};
