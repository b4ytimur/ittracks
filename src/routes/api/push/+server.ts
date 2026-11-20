import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { subscribe, unsubscribe } from '$lib/server/push';
import type { RequestHandler } from './$types';

const subscription = z.object({
	endpoint: z.string().url().max(2000),
	keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) })
});

/** Save this browser's push subscription. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.account) error(401);
	const parsed = subscription.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Not a push subscription');
	subscribe(locals.account.id, parsed.data);
	return json({ ok: true });
};

/** Forget this browser. */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.account) error(401);
	const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
	if (body?.endpoint) unsubscribe(locals.account.id, body.endpoint);
	return json({ ok: true });
};
