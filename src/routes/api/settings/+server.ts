// Change one line of the settings.
import { error, json } from '@sveltejs/kit';
import { patchSettings } from '$lib/server/settings-patch';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.account) error(401);
	const r = patchSettings(locals.account.id, await request.json().catch(() => null));
	if ('error' in r) return json(r, { status: 400 });
	if ('moved' in r) return json({ error: 'This changed on another device, and is shown as it is there now.', ...r }, { status: 409 });
	return json(r);
};
