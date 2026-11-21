// Actions from a reminder notification's buttons, sent by the service worker.
import { error, json } from '@sveltejs/kit';
import { ownedOccurrence } from '$lib/server/owned';
import { timeIn } from '$lib/server/today';
import { appActor } from '$lib/server/core/actor';
import { doneOcc } from '$lib/server/core/log';
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
	const actor = appActor(locals.account.id, undefined, 'reminder');
	let r: ReturnType<typeof doneOcc>;
	if (action === 'done') r = doneOcc(actor, o.occ, 'same', null);
	else if (action === 'minimum') r = doneOcc(actor, o.occ, 'targets', 'minimum');
	else error(400, 'Unknown action');
	// A required field is still empty: the service worker opens the quick log instead.
	if (r === 'needsInput') return json({ ok: false, open: `/log/${o.occ.id}?quick` }, { status: 409 });
	return json({ ok: true });
};
