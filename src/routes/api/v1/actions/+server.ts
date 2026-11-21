// The list of v1 actions this key may call, with a JSON Schema for each input. The MCP server
// builds its tools from this. Internal and still changing: read it, don't hard-code it.
import { catalog } from '$lib/server/core/actions';
import { answer, apiActor, bearer, unauthorized } from '$lib/server/core/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	const actor = apiActor(event);
	if (!actor) return unauthorized(!!bearer(event.request));
	return answer(() => catalog(actor));
};
