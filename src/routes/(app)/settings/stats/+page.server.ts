import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { metric, task } from '$lib/server/db/schema';
import { getStats } from '$lib/server/stats';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const accountId = locals.account!.id;
	const s = getStats(accountId);
	// Number fields a formula can use, by name, with the Tasks that have them.
	const rows = db
		.select({ name: metric.name, task: task.name, type: metric.type })
		.from(metric)
		.innerJoin(task, eq(metric.taskId, task.id))
		.where(and(eq(task.accountId, accountId), inArray(metric.type, ['number', 'count', 'duration', 'checkbox']), eq(task.archived, false)))
		.all();
	const fields = new Map<string, string[]>();
	for (const r of rows) fields.set(r.name, [...new Set([...(fields.get(r.name) ?? []), r.task])]);
	return {
		measures: s.measures,
		e1rm: s.e1rm,
		e1rmMaxReps: s.e1rmMaxReps,
		muscle: s.muscle,
		fields: [...fields.entries()].map(([name, tasks]) => ({ name, tasks })).sort((a, b) => a.name.localeCompare(b.name))
	};
};
