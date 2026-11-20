import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { firstError, taskForm, type TaskForm } from '$lib/forms';
import {
	deleteTask,
	duplicateTask,
	getTaskForm,
	listTagNames,
	saveTask,
	setTaskArchived,
	taskUsage
} from '$lib/server/repo/tasks';
import { listAreas } from '$lib/server/repo/areas';
import { listCollections } from '$lib/server/repo/collections';
import { getSettings, saveSettings } from '$lib/server/settings';
import { BUILTIN_TASK_TYPES } from '$lib/task-types';
import { metricTypes } from '$lib/metric-types';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

const blank = (): TaskForm => ({
	name: '',
	notes: '',
	restTimerEnabled: false,
	restTimerSeconds: 90,
	tags: [],
	metrics: [],
	subtasks: [],
	areaId: null,
	collectionIds: []
});

export const load: PageServerLoad = ({ locals, params, url }) => {
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
	const settings = getSettings(accountId);
	const archived = isNew
		? false
		: !!db.select({ a: task.archived }).from(task).where(and(eq(task.id, params.id), eq(task.accountId, accountId))).get()?.a;
	return {
		isNew,
		task: form,
		archived,
		allTags: listTagNames(accountId),
		weightUnit: settings.weightUnit,
		areas: listAreas(accountId),
		collections: listCollections(accountId).filter((c) => !c.filter),
		types: [...BUILTIN_TASK_TYPES, ...settings.taskTypes],
		usage: isNew ? null : (taskUsage(accountId).get(params.id) ?? { habits: [], lastLogged: null, timesLogged: 0 })
	};
};

const savedType = z.object({
	name: z.string().trim().min(1).max(40),
	restTimerEnabled: z.boolean(),
	metrics: z
		.array(
			z.object({
				name: z.string().trim().min(1).max(120),
				type: z.enum(metricTypes),
				unit: z.string().max(20),
				repeats: z.boolean(),
				step: z.number().positive().nullable()
			})
		)
		.max(20)
});

export const actions: Actions = {
	save: async ({ request, locals, params, url }) => {
		const raw = (await request.formData()).get('payload');
		let json: unknown;
		try {
			json = JSON.parse(String(raw));
		} catch {
			return fail(400, { error: 'Could not read the form.' });
		}
		const parsed = taskForm.safeParse(json);
		if (!parsed.success) return fail(400, { error: firstError(parsed.error) });
		const accountId = locals.account!.id;
		if (parsed.data.areaId && !listAreas(accountId).some((a) => a.id === parsed.data.areaId)) parsed.data.areaId = null;
		const id = saveTask(accountId, params.id === 'new' ? null : params.id, parsed.data);
		if (!id) error(404, 'Task not found');
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
		const s = getSettings(accountId);
		const t = parsed.data;
		const key = `user-${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
		const type = {
			key,
			name: t.name,
			description: t.metrics.map((m) => m.name).join(', ') || 'Just done',
			restTimerEnabled: t.restTimerEnabled,
			metrics: t.metrics.map((m) => ({ ...m, unit: m.unit }))
		};
		saveSettings(accountId, { taskTypes: [...s.taskTypes.filter((x) => x.key !== key), type].slice(-20) });
		return { typeSaved: t.name };
	},
	delete: ({ locals, params }) => {
		deleteTask(locals.account!.id, params.id);
		redirect(303, '/library');
	}
};
