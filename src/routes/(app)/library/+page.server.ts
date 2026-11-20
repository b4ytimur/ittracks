import { listTagNames, listTasks, taskUsage } from '$lib/server/repo/tasks';
import { listAreas } from '$lib/server/repo/areas';
import { collectionTasks, listCollections } from '$lib/server/repo/collections';
import { getSettings } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
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
		groupByArea: getSettings(accountId).groupByArea,
		showArchived
	};
};
