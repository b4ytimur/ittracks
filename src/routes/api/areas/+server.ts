// Areas changed in place, one at a time: rename, recolour, reorder, add, delete and put back.
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { addArea, changeArea, deleteArea, moveAreas, restoreArea } from '$lib/server/repo/areas';
import type { RequestHandler } from './$types';

const id = z.string().uuid();
const name = z.string().trim().min(1).max(40);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const body = z.discriminatedUnion('op', [
	z.object({ op: z.literal('change'), id, name: name.optional(), color: color.optional(), icon: z.string().max(8).optional() }),
	z.object({ op: z.literal('add'), name }),
	z.object({ op: z.literal('move'), order: z.array(id).max(200) }),
	z.object({ op: z.literal('delete'), id }),
	z.object({
		op: z.literal('restore'),
		deleted: z.object({
			row: z.object({ id, name, color, icon: z.string().max(8), sortOrder: z.number().int() }),
			habitIds: z.array(id).max(2000),
			taskIds: z.array(id).max(5000)
		})
	})
]);

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.account) error(401);
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Not a change to an Area');
	const me = locals.account.id;
	const b = parsed.data;
	switch (b.op) {
		case 'change': {
			const { op: _, id, ...values } = b;
			if (!changeArea(me, id, values)) error(404, 'No such Area');
			return json({ ok: true });
		}
		case 'add':
			return json({ id: addArea(me, b.name) });
		case 'move':
			moveAreas(me, b.order);
			return json({ ok: true });
		case 'delete': {
			const deleted = deleteArea(me, b.id);
			if (!deleted) error(404, 'No such Area');
			return json({ deleted });
		}
		case 'restore':
			restoreArea(me, b.deleted);
			return json({ ok: true });
	}
};
