import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { listTagNames, listTasks } from '$lib/server/repo/tasks';
import { listAreas } from '$lib/server/repo/areas';
import { collectionTasks, deleteCollection, listCollections, saveCollection } from '$lib/server/repo/collections';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const accountId = locals.account!.id;
	const all = listCollections(accountId);
	const isNew = params.id === 'new';
	const c = isNew ? null : all.find((x) => x.id === params.id);
	if (!isNew && !c) error(404, 'Collection not found');
	const tasks = listTasks(accountId);
	return {
		isNew,
		collection: c ?? { id: '', name: '', parentId: null, filter: null, taskIds: [] },
		hasChildren: !!c && all.some((x) => x.parentId === c.id),
		parents: all.filter((x) => !x.parentId && x.id !== c?.id).map(({ id, name }) => ({ id, name })),
		tasks: tasks.map(({ id, name, tags, areaId }) => ({ id, name, tags, areaId })),
		tags: listTagNames(accountId),
		areas: listAreas(accountId),
		matching: c ? [...collectionTasks(c, all, tasks)] : []
	};
};

const input = z.object({
	name: z.string().trim().min(1, 'Name the collection').max(80),
	parentId: z.string().uuid().nullable(),
	smart: z.boolean(),
	filter: z.object({ tags: z.array(z.string().max(40)).max(20), areaId: z.string().uuid().nullable(), text: z.string().max(80) }),
	taskIds: z.array(z.string().uuid()).max(2000)
});

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		let json: unknown;
		try {
			json = JSON.parse(String((await request.formData()).get('payload')));
		} catch {
			return fail(400, { error: 'Could not read the form.' });
		}
		const p = input.safeParse(json);
		if (!p.success) return fail(400, { error: p.error.issues[0]?.message ?? 'Check the form.' });
		const f = p.data;
		if (f.smart && !f.filter.tags.length && !f.filter.areaId && !f.filter.text.trim())
			return fail(400, { error: 'A smart collection needs at least one rule.' });
		const id = saveCollection(locals.account!.id, params.id === 'new' ? null : params.id, {
			name: f.name,
			parentId: f.parentId,
			filter: f.smart ? { ...f.filter, text: f.filter.text.trim() } : null,
			taskIds: f.taskIds
		});
		if (!id) error(404, 'Collection not found');
		redirect(303, `/library?collection=${id}`);
	},
	delete: ({ locals, params }) => {
		deleteCollection(locals.account!.id, params.id);
		redirect(303, '/library');
	}
};
