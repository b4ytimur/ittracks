// Change one line of a habit.
import { error, json } from '@sveltejs/kit';
import { habitPatch, patchHabit } from '$lib/server/habit-patch';
import { ownedHabit } from '$lib/server/owned';
import { getSettings, saveSettings } from '$lib/server/settings';
import { userToday } from '$lib/server/today';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, locals, params, cookies }) => {
	if (!locals.account) error(401);
	const p = habitPatch.safeParse(await request.json().catch(() => null));
	if (!p.success) error(400, 'Not a change to a habit');
	if (p.data.pinned !== undefined) {
		if (!ownedHabit(locals.account.id, params.id)) error(404);
		const s = getSettings(locals.account.id);
		const rest = s.pinned.filter((x) => x !== params.id);
		// The menu holds four.
		saveSettings(locals.account.id, { pinned: p.data.pinned ? [...rest, params.id].slice(-4) : rest });
		return json({ ok: true });
	}
	const r = patchHabit(locals.account.id, params.id, p.data, userToday(locals.account.id, cookies.get('tz')));
	if ('error' in r) return json({ error: r.error }, { status: r.status });
	if ('moved' in r) return json({ error: 'This changed on another device.', moved: r.moved, form: r.form }, { status: 409 });
	return json(r);
};
