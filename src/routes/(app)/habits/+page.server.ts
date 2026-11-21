import { fail } from '@sveltejs/kit';
import { listHabits } from '$lib/server/repo/habits';
import { listAreas } from '$lib/server/repo/areas';
import { addTemplate } from '$lib/server/repo/templates';
import { getViews } from '$lib/server/settings';
import { identitiesByHabit } from '$lib/server/repo/identities';
import { habitStats } from '$lib/engine/stats';
import { db } from '$lib/server/db';
import { habit, occurrence } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { userToday } from '$lib/server/today';
import { templateFile } from '$lib/template';
import { initialState } from '$lib/views';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url, cookies }) => {
	const accountId = locals.account!.id;
	const today = userToday(accountId, cookies.get('tz'));
	const idents = identitiesByHabit(accountId);
	// Every Occurrence of the user's habits in one query, for consistency and "last done".
	const marks = new Map<string, { date: string; status: string }[]>();
	for (const m of db
		.select({ habitId: occurrence.habitId, date: occurrence.date, status: occurrence.status })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(eq(habit.accountId, accountId))
		.all())
		marks.set(m.habitId, [...(marks.get(m.habitId) ?? []), m]);
	const views = getViews(accountId);
	// The old ?archived link still works: it turns the archived filter on.
	const initial = initialState(views, 'habits');
	if (url.searchParams.has('archived')) initial.archived = true;
	return {
		habits: listHabits(accountId, { archived: true }).map((h) => {
			const st = habitStats(marks.get(h.id) ?? [], today);
			return {
				...h,
				createdAt: h.createdAt.getTime(),
				identities: idents.get(h.id) ?? [],
				consistency: h.direction === 'break' ? null : st.consistency,
				lastDone: st.lastDone
			};
		}),
		areas: listAreas(accountId),
		views,
		initial,
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
