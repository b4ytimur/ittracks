// Change one line of a Task.
import { error, json } from '@sveltejs/kit';
import { appActor } from '$lib/server/core/actor';
import { patchTask, taskPatch } from '$lib/server/task-patch';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, locals, params, cookies }) => {
	if (!locals.account) error(401);
	const p = taskPatch.safeParse(await request.json().catch(() => null));
	if (!p.success) error(400, 'Not a change to a Task');
	const r = patchTask(appActor(locals.account.id, cookies.get('tz')), params.id, p.data);
	if ('error' in r) return json({ error: r.error }, { status: r.status });
	if ('moved' in r) return json({ error: 'This changed on another device.', moved: r.moved, form: r.form }, { status: 409 });
	return json(r);
};
