import { fail } from '@sveltejs/kit';
import { listHabits } from '$lib/server/repo/habits';
import { listAreas } from '$lib/server/repo/areas';
import { addTemplate } from '$lib/server/repo/templates';
import { getSettings } from '$lib/server/settings';
import { userToday } from '$lib/server/today';
import { templateFile } from '$lib/template';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const accountId = locals.account!.id;
	const showArchived = url.searchParams.has('archived');
	return {
		habits: listHabits(accountId, { archived: showArchived }),
		areas: listAreas(accountId),
		groupByArea: getSettings(accountId).groupByArea,
		showArchived,
		added: url.searchParams.get('added')
	};
};

export const actions: Actions = {
	/** Create a Habit and its Tasks from a template file. */
	import: async ({ request, locals, cookies }) => {
		const f = await request.formData();
		const file = f.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose a template file.' });
		if (file.size > 1_000_000) return fail(400, { error: 'That file is too large for a template.' });
		let parsed;
		try {
			parsed = templateFile.safeParse(JSON.parse(await file.text()));
		} catch {
			return fail(400, { error: 'That file is not valid JSON.' });
		}
		if (!parsed.success) return fail(400, { error: 'That file is not an ittracks template.' });
		const accountId = locals.account!.id;
		const r = addTemplate(accountId, parsed.data, {
			today: userToday(accountId, cookies.get('tz')),
			reuse: f.get('separate') !== 'on'
		});
		if ('error' in r) return fail(400, { error: r.error });
		return { imported: r.name, taskCount: r.created, reused: r.reused };
	}
};
