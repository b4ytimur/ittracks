import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import type { Handle } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { account, appValue } from '$lib/server/db/schema';
import { building } from '$app/environment';
import { readSession, SESSION_COOKIE } from '$lib/server/auth';
import { startReminders } from '$lib/server/push';
import { actorForKey } from '$lib/server/core/tokens';
import { restorePartialDays } from '$lib/server/today';

// Bring the database up to date on startup, so self-hosters never run migrations by hand.
migrate(db, { migrationsFolder: './drizzle' });
// Once: days that got part of the way and were settled as missed before the partial-day rule.
if (!building && !db.select().from(appValue).where(eq(appValue.key, 'partial-days-restored')).get()) {
	db.transaction(() => {
		const n = restorePartialDays();
		db.insert(appValue).values({ key: 'partial-days-restored', value: String(n) }).run();
	});
}
if (!building) startReminders();

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.account = readSession(event.cookies.get(SESSION_COOKIE));
	// A quick-log link with a key (NFC tag, QR code, Shortcut) works without signing in, for
	// that one page only: the key never stands in for a login anywhere else.
	const key = event.url.searchParams.get('key');
	if (!event.locals.account && key && event.url.pathname.startsWith('/q/')) {
		const actor = actorForKey(key, 'link');
		const row = actor && db.select({ id: account.id, username: account.username }).from(account).where(eq(account.id, actor.accountId)).get();
		if (actor && row) {
			event.locals.account = row;
			event.locals.actor = actor;
		} else if (event.request.method === 'GET' && (event.request.headers.get('accept') ?? '').includes('text/html'))
			// An NFC tag or QR code with a revoked key: say so, rather than asking a stranger to sign in.
			return new Response('This quick-log link\'s key is not valid: it may have been revoked or mistyped. Make a new key in ittracks under Settings → Integrations.', {
				status: 401,
				headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
			});
	}
	const response = await resolve(event);
	// The key is in this page's address: don't pass it on to other sites as a referrer.
	if (event.locals.actor?.source === 'link') response.headers.set('referrer-policy', 'no-referrer');
	return response;
};
