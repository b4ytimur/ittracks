// The Undo of adding a template: the habits and Tasks it made, and the pack that came with it.
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { packUndo, undoPack } from '$lib/server/packs';
import { unadd } from '$lib/server/repo/templates';
import { userToday } from '$lib/server/today';
import type { RequestHandler } from './$types';

const ids = z.array(z.string().max(64)).max(500);
const body = z.object({ made: z.object({ habits: ids.min(1), tasks: ids }), pack: packUndo.nullable() });

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.account) error(401);
	const b = body.safeParse(await request.json().catch(() => null));
	if (!b.success) error(400, 'Not something that was added');
	if (!unadd(locals.account.id, b.data.made, userToday(locals.account.id, cookies.get('tz')))) return json({ error: 'It is already gone.' }, { status: 404 });
	// The pack stays when something of it was changed since.
	if (b.data.pack) undoPack(locals.account.id, b.data.pack);
	return json({ ok: true });
};
