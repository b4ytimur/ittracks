// The app's view changes. The change itself is src/lib/server/views.ts, shared with setup.
import { error, json } from '@sveltejs/kit';
import { ActionError } from '$lib/server/core/actor';
import { changeViews } from '$lib/server/views';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.account) error(401);
	const raw = await request.json().catch(() => null);
	try {
		const r = changeViews(locals.account.id, raw);
		return json({ ok: true, ...r });
	} catch (e) {
		if (e instanceof ActionError) error(400, e.message);
		throw e;
	}
};
