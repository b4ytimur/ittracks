// Put back a habit or Task that was just deleted.
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { untrash } from '$lib/server/trash';
import { userToday } from '$lib/server/today';
import type { RequestHandler } from './$types';

const body = z.object({ kind: z.enum(['habit', 'task']), id: z.string().max(64), archived: z.boolean() });

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.account) error(401);
	const p = body.safeParse(await request.json().catch(() => null));
	if (!p.success) error(400, 'Not something to put back');
	if (!untrash(locals.account.id, p.data.kind, p.data.id, p.data.archived, userToday(locals.account.id, cookies.get('tz')))) error(404, 'It is gone for good.');
	return json({ ok: true });
};
