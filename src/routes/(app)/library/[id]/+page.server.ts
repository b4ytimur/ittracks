import { userToday } from '$lib/server/today';
import { trash } from '$lib/server/trash';
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { rowWords, type TaskForm } from '$lib/forms';
import {
	libraryForParts,
	duplicateTask,
	getTaskForm,
	listTagNames,
	setTaskArchived,
	taskUsage
} from '$lib/server/repo/tasks';
import { taskLoggedLists } from '$lib/server/history';
import { appActor } from '$lib/server/core/actor';
import type { UnitChoice } from '$lib/units';
import { listAreas } from '$lib/server/repo/areas';
import { listCollections } from '$lib/server/repo/collections';
import { getPacks, getTaskTypes, saveSettings } from '$lib/server/settings';
import { ownTypes } from '$lib/server/settings-patch';
import { metricTypes } from '$lib/metric-types';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { catalogFor, getStats, itemsFor, statsContext } from '$lib/server/stats';
import { getViews } from '$lib/server/settings';
import { taskCards } from '$lib/stats/auto';
import { saveTaskChecked } from '$lib/server/core/save';
import type { Actions, PageServerLoad } from './$types';

const blank = (): TaskForm => ({
	name: '',
	notes: '',
	restTimerEnabled: false,
	restTimerSeconds: 90,
	...rowWords(),
	tags: [],
	metrics: [],
	parts: [],
	areaId: null,
	collectionIds: []
});

/** Charts of everything this Task has logged (its history, from the stats engine). */
function taskHistory(accountId: string, taskId: string, tz: string | undefined) {
	const { P, today } = statsContext(accountId, tz);
	const t = P.tasks.get(taskId);
	if (!t || !(P.logsByTask.get(taskId) ?? []).length) return null;
	const s = getStats(accountId);
	const catalog = catalogFor(accountId, P);
	return { items: itemsFor(taskCards(P, t), P, { catalog, stats: s, hidden: getViews(accountId).hidden, today }), catalog, measures: s.measures };
}

export const load: PageServerLoad = ({ locals, params, url, cookies }) => {
	const accountId = locals.account!.id;
	const isNew = params.id === 'new';
	const form = isNew ? blank() : getTaskForm(accountId, params.id);
	if (!form) error(404, 'Task not found');
	if (isNew) {
		const area = url.searchParams.get('area');
		if (area) form.areaId = area;
		const c = url.searchParams.get('collection');
		if (c) form.collectionIds = [c];
	}
	const row = isNew
		? null
		: db.select({ a: task.archived, gone: task.deleteAfter }).from(task).where(and(eq(task.id, params.id), eq(task.accountId, accountId))).get();
	return {
		isNew,
		taskId: params.id,
		task: form,
		archived: !!row?.a,
		/** Deleted: when it goes for good (ms), so the page can offer Put back. */
		deleteAfter: row?.gone?.getTime() ?? null,
		allTags: listTagNames(accountId),
		areas: listAreas(accountId),
		collections: listCollections(accountId).filter((c) => !c.filter),
		types: getTaskTypes(accountId),
		usage: isNew ? null : (taskUsage(accountId).get(params.id) ?? { habits: [], inside: [], lastLogged: null, timesLogged: 0 }),
		/** Fields with logged values, parts with logs under them and options picked: the history policies guard their edits. */
		logged: isNew ? { metrics: [] as string[], parts: [] as string[], options: [] as string[] } : taskLoggedLists(params.id),
		/** Library Tasks that can go inside this one, with what the part editor needs of each. */
		library: libraryForParts(accountId, isNew ? null : params.id),
		history: isNew ? null : taskHistory(accountId, params.id, cookies.get('tz'))
	};
};

/** The editor's pick per Metric id for a unit change on a field with logged values. */
const unitChoice = z.record(z.string().uuid(), z.enum(['convert', 'relabel']));

const savedType = z.object({
	name: z.string().trim().min(1).max(40),
	restTimerEnabled: z.boolean(),
	words: z.object({ rowOne: z.string().max(20), rowMany: z.string().max(20), betweenName: z.string().max(20) }).optional(),
	metrics: z
		.array(
			z.object({
				name: z.string().trim().min(1).max(120),
				type: z.enum(metricTypes),
				unit: z.string().max(20),
				repeats: z.boolean(),
				times: z.boolean().optional(),
				better: z.literal('less').optional(),
				step: z.number().positive().nullable()
			})
		)
		.max(20)
});

export const actions: Actions = {
	save: async ({ request, locals, params, url, cookies }) => {
		const form = await request.formData();
		let json: unknown;
		let unitChoices: Record<string, UnitChoice> = {};
		try {
			json = JSON.parse(String(form.get('payload')));
			unitChoices = unitChoice.parse(JSON.parse(String(form.get('units') ?? '{}')));
		} catch {
			return fail(400, { error: 'Could not read the form.' });
		}
		const accountId = locals.account!.id;
		const editing = params.id === 'new' ? null : params.id;
		// The checks, the save and the unit-change events are shared with setup (src/lib/server/core/save.ts).
		const r = saveTaskChecked(appActor(accountId, cookies.get('tz')), editing, json, unitChoices);
		if ('notFound' in r) error(404, 'Task not found');
		if ('error' in r) return fail(400, { error: r.error });
		const back = url.searchParams.get('back');
		redirect(303, back && back.startsWith('/') && !back.startsWith('//') ? back : '/library');
	},
	/** Keep the history, hide it from the Library and pickers. */
	archive: ({ locals, params }) => {
		setTaskArchived(locals.account!.id, params.id, true);
		redirect(303, '/library');
	},
	unarchive: ({ locals, params }) => {
		setTaskArchived(locals.account!.id, params.id, false);
		return { unarchived: true };
	},
	duplicate: ({ locals, params }) => {
		const id = duplicateTask(locals.account!.id, params.id);
		if (!id) error(404, 'Task not found');
		redirect(303, `/library/${id}`);
	},
	/** Save the current Metrics as a Task type of your own. */
	saveType: async ({ request, locals }) => {
		let json: unknown;
		try {
			json = JSON.parse(String((await request.formData()).get('type')));
		} catch {
			return fail(400, { error: 'Could not read the type.' });
		}
		const parsed = savedType.safeParse(json);
		if (!parsed.success) return fail(400, { error: 'Give the type a name and at least one valid field.' });
		const accountId = locals.account!.id;
		const t = parsed.data;
		const key = `user-${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
		const type = {
			key,
			name: t.name,
			description: t.metrics.map((m) => m.name).join(', ') || 'Just done',
			restTimerEnabled: t.restTimerEnabled,
			...(t.words ? { words: t.words } : {}),
			metrics: t.metrics.map((m) => ({ ...m, unit: m.unit }))
		};
		saveSettings(accountId, { taskTypes: [...ownTypes(accountId).filter((x) => x.key !== key), type].slice(-60), packs: getPacks(accountId) });
		return { typeSaved: t.name };
	},
	delete: ({ locals, params, cookies }) => {
		const deleted = trash(locals.account!.id, 'task', params.id, userToday(locals.account!.id, cookies.get('tz')));
		return deleted ? { deleted } : fail(404, { error: 'No such Task' });
	}
};
