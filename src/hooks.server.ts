import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Handle } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { readSession, SESSION_COOKIE } from '$lib/server/auth';

// Bring the database up to date on startup, so self-hosters never run migrations by hand.
migrate(db, { migrationsFolder: './drizzle' });

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.account = readSession(event.cookies.get(SESSION_COOKIE));
	return resolve(event);
};
