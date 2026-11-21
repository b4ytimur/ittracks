import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { galleryItem } from '$lib/gallery';
import { getSettings } from '$lib/server/settings';
import { userToday } from '$lib/server/today';
import { addTemplate, readAddForm } from '$lib/server/repo/templates';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { listHabits } from '$lib/server/repo/habits';
import { listAreas } from '$lib/server/repo/areas';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, cookies }) => {
	const accountId = locals.account!.id;
	const item = galleryItem(params.slug, getSettings(accountId).weightUnit);
	if (!item) error(404, 'Template not found');
	const names = (rows: { name: string }[]) => rows.map((r) => r.name.trim().toLowerCase());
	return {
		slug: item.slug,
		template: item.template,
		libraryNames: names(
			db.select({ name: task.name }).from(task).where(and(eq(task.accountId, accountId), isNull(task.parentTaskId), eq(task.archived, false))).all()
		),
		habitNames: names(listHabits(accountId)),
		areaNames: names(listAreas(accountId)),
		today: userToday(accountId, cookies.get('tz'))
	};
};

export const actions: Actions = {
	add: async ({ request, locals, params, cookies }) => {
		const accountId = locals.account!.id;
		const item = galleryItem(params.slug, getSettings(accountId).weightUnit);
		if (!item) error(404, 'Template not found');
		const add = readAddForm(await request.formData(), item.template);
		const tpl = add.tpl;
		const r = addTemplate(accountId, tpl, { today: userToday(accountId, cookies.get('tz')), ...add });
		if ('error' in r) return fail(400, { error: r.error });
		redirect(303, `/habits?added=${encodeURIComponent(r.name)}${tpl.view ? `&view=${encodeURIComponent(tpl.view)}` : ''}`);
	}
};
