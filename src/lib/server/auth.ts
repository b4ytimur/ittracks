import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { newAccountSettings } from './settings';
import { eq } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import type { Cookies } from '@sveltejs/kit';
import { db } from './db';
import { account, authSession, settings } from './db/schema';

export const SESSION_COOKIE = 'ittracks_session';
const SESSION_DAYS = 30;

// The cookie holds a random token; the database only stores its hash.
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const accountCount = () => db.select({ id: account.id }).from(account).all().length;

export async function createAccount(username: string, password: string) {
	const id = randomUUID();
	db.insert(account)
		.values({ id, username, passwordHash: await hash(password) })
		.run();
	db.insert(settings)
		.values({ accountId: id, data: newAccountSettings() })
		.run();
	return id;
}

export async function checkPassword(username: string, password: string) {
	const row = db.select().from(account).where(eq(account.username, username)).get();
	if (!row || !(await verify(row.passwordHash, password))) return null;
	return row.id;
}

export function startSession(accountId: string, cookies: Cookies, secure: boolean) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
	db.insert(authSession).values({ id: hashToken(token), accountId, expiresAt }).run();
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires: expiresAt
	});
}

export function readSession(token: string | undefined) {
	if (!token) return null;
	const row = db
		.select({ expiresAt: authSession.expiresAt, id: account.id, username: account.username })
		.from(authSession)
		.innerJoin(account, eq(authSession.accountId, account.id))
		.where(eq(authSession.id, hashToken(token)))
		.get();
	if (!row || row.expiresAt.getTime() < Date.now()) return null;
	return { id: row.id, username: row.username };
}

export function endSession(token: string | undefined, cookies: Cookies) {
	if (token) db.delete(authSession).where(eq(authSession.id, hashToken(token))).run();
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
