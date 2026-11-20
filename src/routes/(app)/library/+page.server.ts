import { listTagNames, listTasks } from '$lib/server/repo/tasks';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	tasks: listTasks(locals.account!.id),
	tags: listTagNames(locals.account!.id)
});
