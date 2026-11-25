// Starter packs: copy one in, take one out, and their Undo.
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { dropPack, packUndo, takePack, undoPack } from '$lib/server/packs';
import type { RequestHandler } from './$types';

const body = z.discriminatedUnion('op', [
	z.object({ op: z.enum(['take', 'drop']), id: z.string().max(40) }),
	z.object({ op: z.literal('undo'), undo: packUndo })
]);

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.account) error(401);
	const b = body.safeParse(await request.json().catch(() => null));
	if (!b.success) error(400, 'Not a change to a pack');
	if (b.data.op === 'undo') {
		const why = undoPack(locals.account.id, b.data.undo);
		return why ? json({ error: why }, { status: 409 }) : json({ ok: true });
	}
	const r = b.data.op === 'take' ? takePack(locals.account.id, b.data.id) : dropPack(locals.account.id, b.data.id);
	return 'error' in r ? json(r, { status: 400 }) : json(r);
};
