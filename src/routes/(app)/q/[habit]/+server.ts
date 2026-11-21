// The same quick-log link for programs (Shortcuts' "Get contents of URL", Tasker, curl, an
// ESP32 button): answers JSON, or plain text with ?reply=text so Siri can read it out. A
// browser opening the link gets the page instead. Takes the key as ?key=… or a Bearer header.
import { json, text } from '@sveltejs/kit';
import { appActor } from '$lib/server/core/actor';
import { actorForKey, keyFrom } from '$lib/server/core/tokens';
import { fail, unauthorized } from '$lib/server/core/http';
import { once, quickLog, quickParams } from '$lib/server/core/quick';
import type { RequestHandler } from './$types';

async function handle(event: Parameters<RequestHandler>[0], method: 'GET' | 'POST') {
	const { request, url, params, locals, cookies } = event;
	const key = keyFrom(request, url);
	const actor = key ? actorForKey(key, 'link') : locals.account ? appActor(locals.account.id, cookies.get('tz')) : null;
	if (!actor) return unauthorized(!!key);
	let body: Record<string, string> = {};
	if (method === 'POST') {
		const type = request.headers.get('content-type') ?? '';
		try {
			if (type.includes('application/json')) body = Object.fromEntries(Object.entries((await request.json()) ?? {}).map(([k, v]) => [k, String(v)]));
			else if (type.includes('form')) body = Object.fromEntries([...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]));
		} catch {
			body = {};
		}
	}
	const p = quickParams((k) => body[k] ?? url.searchParams.get(k));
	try {
		const run = () => quickLog(actor, params.habit, p);
		const out = method === 'GET' ? once(`${actor.tokenId ?? actor.accountId}|${url.pathname}|${url.search}`, run) : run();
		if ((body.reply ?? url.searchParams.get('reply')) === 'text') return text(out.message, { headers: { 'cache-control': 'no-store' } });
		return json({ ok: true, message: out.message, needsInput: out.needsInput, repeated: 'repeated' in out ? out.repeated : false, result: out.result }, { headers: { 'cache-control': 'no-store' } });
	} catch (e) {
		if ((body.reply ?? url.searchParams.get('reply')) === 'text' && e instanceof Error) return text(e.message, { status: 400 });
		return fail(e);
	}
}

export const GET: RequestHandler = (event) => handle(event, 'GET');
export const POST: RequestHandler = (event) => handle(event, 'POST');
