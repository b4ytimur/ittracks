// Run one v1 action: POST a JSON body with its input. See GET /api/v1/actions for the list.
import { json } from '@sveltejs/kit';
import { runAction } from '$lib/server/core/actions';
import { answer, apiActor, bearer, fail, unauthorized } from '$lib/server/core/http';
import { ActionError } from '$lib/server/core/actor';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const actor = apiActor(event);
	if (!actor) return unauthorized(!!bearer(event.request));
	// JSON only: a cross-site form can't send it without the browser asking first.
	if (!(event.request.headers.get('content-type') ?? '').includes('application/json'))
		return json({ ok: false, error: { code: 'invalid', message: 'Send the input as JSON (Content-Type: application/json).' } }, { status: 415 });
	let input: unknown;
	try {
		const text = await event.request.text();
		input = text.trim() ? JSON.parse(text) : {};
	} catch {
		return fail(new ActionError('invalid', 'The body is not valid JSON.'));
	}
	return answer(() => runAction(actor, event.params.name, input));
};
