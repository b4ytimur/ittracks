import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { metric, task } from '$lib/server/db/schema';
import { userToday } from '$lib/server/today';
import { effectiveUnit } from '$lib/units';
import { listTagNames, listTasks, taskUsage } from '$lib/server/repo/tasks';
import { listAreas } from '$lib/server/repo/areas';
import { collectionTasks, listCollections } from '$lib/server/repo/collections';
import { getViews } from '$lib/server/settings';
import { initialState } from '$lib/views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url, cookies }) => {
	const accountId = locals.account!.id;
	const showArchived = url.searchParams.has('archived');
	const tasks = listTasks(accountId, { archived: showArchived });
	const usage = taskUsage(accountId);
	const collections = listCollections(accountId);
	return {
		tasks: tasks.map((t) => ({
			...t,
			createdAt: t.createdAt.getTime(),
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
			.map((m) => ({ taskId: m.taskId, name: m.name, unit: effectiveUnit(m) }))
	};
};
