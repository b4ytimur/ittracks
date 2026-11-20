// Actions from a reminder notification's buttons, sent by the service worker.
import { error, json } from '@sveltejs/kit';
import { ownedOccurrence } from '$lib/server/owned';
import { quickDone, sameAsLast, timeIn } from '$lib/server/today';
import { snooze } from '$lib/server/push';
import { getSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, params }) => {
	if (!locals.account) error(401);
	const o = ownedOccurrence(locals.account.id, params.id);
	if (!o) error(404);
	const body = (await request.json().catch(() => null)) as { action?: string } | null;
	const action = body?.action;
	if (action === 'snooze') {
		snooze(o.habit.id, o.occ.date, timeIn(getSettings(locals.account.id).timeZone));
		return json({ ok: true });
	}
	if (o.occ.status !== 'due') return json({ ok: true, already: o.occ.status });
	if (action === 'done') sameAsLast(o.occ.id);
	else if (action === 'minimum') quickDone(o.occ.id, 'minimum');
	else error(400, 'Unknown action');
	return json({ ok: true });
};
