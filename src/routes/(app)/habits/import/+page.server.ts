// Import a template file: the browser reads the file and shows what it adds, with its
// questions, as the Gallery does; adding sends the file back with the answers.
import { fail } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { listHabits } from '$lib/server/repo/habits';
import { listAreas } from '$lib/server/repo/areas';
import { addTemplate, addedPath, readAddForm } from '$lib/server/repo/templates';
import { userToday } from '$lib/server/today';
import { checkTemplate } from '$lib/template';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, cookies }) => {
	const accountId = locals.account!.id;
	const names = (rows: { name: string }[]) => rows.map((r) => r.name.trim().toLowerCase());
	return {
		today: userToday(accountId, cookies.get('tz')),
		libraryNames: names(
			db.select({ name: task.name }).from(task).where(and(eq(task.accountId, accountId), isNull(task.parentTaskId), eq(task.archived, false))).all()
		),
		habitNames: names(listHabits(accountId)),
		areaNames: names(listAreas(accountId))
	};
};

export const actions: Actions = {
	add: async ({ request, locals, cookies }) => {
		const accountId = locals.account!.id;
		const f = await request.formData();
		const text = String(f.get('template') ?? '');
		if (!text) return fail(400, { error: 'Choose a template file.' });
		const checked = checkTemplate(text);
		if (!checked.ok) return fail(400, { error: checked.why });
		const add = readAddForm(f, checked.tpl);
		const r = addTemplate(accountId, add.tpl, { today: userToday(accountId, cookies.get('tz')), ...add });
		if ('error' in r) return fail(400, { error: r.error });
		return { added: { name: r.name, path: addedPath(r, add.tpl.view), made: r.made, pack: null } };
	}
};
