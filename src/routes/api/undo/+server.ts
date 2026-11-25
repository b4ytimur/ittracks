// Take back a change that rewrote past days.
import { error, json } from '@sveltejs/kit';
import { restoreSnapshot } from '$lib/server/snapshot';
import { restoreTaskSnapshot } from '$lib/server/task-snapshot';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.account) error(401);
	const id = String((await request.json().catch(() => ({}))).id ?? '');
	if (!restoreTaskSnapshot(locals.account.id, id) && !restoreSnapshot(locals.account.id, id)) error(409, 'It changed again since, so it is left as it is.');
	return json({ ok: true });
};
