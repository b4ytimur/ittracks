import { fail } from '@sveltejs/kit';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { metric, task, taskPart } from '$lib/server/db/schema';
import { userToday } from '$lib/server/today';
import { effectiveUnit } from '$lib/units';
import { listTagNames, listTasks, renameTask, setTaskArchived, taskUsage } from '$lib/server/repo/tasks';
import { listAreas } from '$lib/server/repo/areas';
import { collectionTasks, listCollections } from '$lib/server/repo/collections';
import { getViews } from '$lib/server/settings';
import { initialState } from '$lib/views';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url, cookies }) => {
	const accountId = locals.account!.id;
	const showArchived = url.searchParams.has('archived');
	const tasks = listTasks(accountId, { archived: showArchived, deleted: showArchived });
	const usage = taskUsage(accountId);
	const collections = listCollections(accountId);
	return {
		tasks: tasks.map((t) => ({
			...t,
			createdAt: t.createdAt.getTime(),
			deleteAfter: t.deleteAfter?.getTime() ?? null,
			usedIn: usage.get(t.id)?.habits.map((h) => h.name) ?? [],
			lastLogged: usage.get(t.id)?.lastLogged ?? null,
			timesLogged: usage.get(t.id)?.timesLogged ?? 0
		})),
		tags: listTagNames(accountId),
		areas: listAreas(accountId),
		collections: collections.map((c) => ({
			id: c.id,
			name: c.name,
			parentId: c.parentId,
			smart: !!c.filter,
			taskIds: [...collectionTasks(c, collections, tasks)]
		})),
		views: getViews(accountId),
		initial: initialState(getViews(accountId), 'library'),
		showArchived,
		/** For the bulk bar: today, and each Task's number fields with their units (Change a unit). */
		today: userToday(accountId, cookies.get('tz')),
		numberFields: db
			.select({ taskId: metric.taskId, name: metric.name, type: metric.type, unit: metric.unit })
			.from(metric)
			.innerJoin(task, eq(metric.taskId, task.id))
			.where(and(eq(task.accountId, accountId), eq(metric.archived, false), inArray(metric.type, ['number', 'count', 'duration'])))
			.all()
			.map((m) => ({ taskId: m.taskId, name: m.name, unit: effectiveUnit(m) })),
		/** Library Tasks inside other Tasks: a unit change reaches their fields too. */
		inside: db
			.select({ taskId: taskPart.taskId, childTaskId: taskPart.childTaskId })
			.from(taskPart)
			.innerJoin(task, eq(taskPart.taskId, task.id))
			.where(and(eq(task.accountId, accountId), eq(taskPart.archived, false), ne(taskPart.id, taskPart.childTaskId)))
			.all()
	};
};

/** Edit mode on the list: rename and archive in place, the same as the Task editor does. */
export const actions: Actions = {
	rename: async ({ request, locals }) => {
		const f = await request.formData();
		const r = renameTask(locals.account!.id, String(f.get('id') ?? ''), String(f.get('name') ?? ''));
		if ('error' in r) return fail(400, { error: r.error });
		return { renamed: r.name };
	},
	archive: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!setTaskArchived(locals.account!.id, id, true)) return fail(404, { error: 'No such Task' });
		return { archived: id };
	},
	unarchive: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!setTaskArchived(locals.account!.id, id, false)) return fail(404, { error: 'No such Task' });
		return { unarchived: id };
	}
};
