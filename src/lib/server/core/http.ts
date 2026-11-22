// The HTTP side of the core: who is calling (a key or the signed-in app), and answers in one
// shape: { ok: true, result } or { ok: false, error: { code, message } }.
import { json, type RequestEvent } from '@sveltejs/kit';
import { ActionError, appActor, type Actor, type Source } from './actor';
import { actorForKey } from './tokens';

/** The key from `Authorization: Bearer itk_…` only: API calls never take a key in the address. */
export function bearer(request: Request): string | null {
	return request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
}

/** The MCP server says so, so the event log can tell its logs apart. */
const sourceOf = (request: Request): Source => (request.headers.get('x-ittracks-client') === 'mcp' ? 'mcp' : 'key');

/** A key's actor, or the signed-in person's; null when neither. A wrong key is never the cookie's fallback. */
export function apiActor(event: Pick<RequestEvent, 'request' | 'locals' | 'cookies'>): Actor | null {
	const key = bearer(event.request);
	if (key) return actorForKey(key, sourceOf(event.request));
	return event.locals.account ? appActor(event.locals.account.id, event.cookies.get('tz')) : null;
}

const NO_STORE = { 'cache-control': 'no-store' };

export function fail(e: unknown) {
	if (e instanceof ActionError)
		return json({ ok: false, error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, { status: e.status, headers: NO_STORE });
	console.error('action failed', e);
	return json({ ok: false, error: { code: 'server', message: 'Something went wrong on the server.' } }, { status: 500, headers: NO_STORE });
}

export function answer(run: () => unknown) {
	try {
		return json({ ok: true, result: run() }, { headers: NO_STORE });
	} catch (e) {
		return fail(e);
	}
}

/** No key, or a key that isn't (or is no longer) valid. */
export const unauthorized = (sentKey = false) =>
	json(
		{
			ok: false,
			error: {
				code: 'unauthorized',
				message: sentKey
					? 'That key is not valid: it may have been revoked or mistyped. Make a new one in Settings → Integrations.'
					: 'Send a key as "Authorization: Bearer itk_…". Make one in Settings → Integrations.'
			}
		},
		{ status: 401, headers: { ...NO_STORE, 'www-authenticate': 'Bearer' } }
	);
