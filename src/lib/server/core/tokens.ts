// Keys for Shortcuts, quick-log links, the MCP server and scripts. A key is a random secret
// shown once; the database keeps only its sha256, like the login cookie. Each key has scopes
// (read, log, notes, export) and can be limited to some habits.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { apiToken, habit } from '../db/schema';
import { ALL_SCOPES, type Actor, type Scope, type Source } from './actor';

export const KEY_PREFIX = 'itk_';
const hashKey = (secret: string) => createHash('sha256').update(secret).digest('hex');
/** Last used is saved at most once a minute, so a busy Shortcut doesn't write on every call. */
const TOUCH_MS = 60_000;
export const MAX_KEYS = 50;

export interface KeySummary {
	id: string;
	name: string;
	hint: string;
	scopes: Scope[];
	habitIds: string[] | null;
	createdAt: Date;
	lastUsedAt: Date | null;
}

const cleanScopes = (xs: string[]): Scope[] => ALL_SCOPES.filter((s) => xs.includes(s));

export function listKeys(accountId: string): KeySummary[] {
	return db
		.select()
		.from(apiToken)
		.where(eq(apiToken.accountId, accountId))
		.orderBy(desc(apiToken.createdAt))
		.all()
		.map((t) => ({
			id: t.id,
			name: t.name,
			hint: t.hint,
			scopes: cleanScopes(t.scopes),
			habitIds: t.habitIds,
			createdAt: t.createdAt,
			lastUsedAt: t.lastUsedAt
		}));
}

/** Make a key. Returns the secret, which is never shown again. */
export function createKey(
	accountId: string,
	opts: { name: string; scopes: Scope[]; habitIds: string[] | null }
): { id: string; secret: string } | { error: string } {
	const name = opts.name.trim().slice(0, 60);
	if (!name) return { error: 'Give the key a name, such as “iPhone Shortcuts”.' };
	const scopes = cleanScopes(opts.scopes);
	if (!scopes.length) return { error: 'Pick at least one thing the key may do.' };
	if (listKeys(accountId).length >= MAX_KEYS) return { error: `You can have up to ${MAX_KEYS} keys. Revoke one you no longer use.` };
	let habitIds: string[] | null = null;
	if (opts.habitIds) {
		const own = new Set(db.select({ id: habit.id }).from(habit).where(eq(habit.accountId, accountId)).all().map((h) => h.id));
		habitIds = [...new Set(opts.habitIds)].filter((id) => own.has(id));
		if (!habitIds.length) return { error: 'Pick at least one habit, or allow every habit.' };
	}
	const secret = KEY_PREFIX + randomBytes(32).toString('base64url');
	const id = randomUUID();
	db.insert(apiToken)
		.values({ id, accountId, name, hash: hashKey(secret), hint: secret.slice(0, KEY_PREFIX.length + 6), scopes, habitIds })
		.run();
	return { id, secret };
}

export function revokeKey(accountId: string, id: string): boolean {
	return db.delete(apiToken).where(and(eq(apiToken.id, id), eq(apiToken.accountId, accountId))).run().changes > 0;
}

/** The actor for a secret, or null when it is unknown (revoked, mistyped). */
export function actorForKey(secret: string | null | undefined, source: Source = 'key'): Actor | null {
	if (!secret || !secret.startsWith(KEY_PREFIX) || secret.length > 200) return null;
	const row = db.select().from(apiToken).where(eq(apiToken.hash, hashKey(secret))).get();
	if (!row) return null;
	const now = Date.now();
	if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > TOUCH_MS)
		db.update(apiToken).set({ lastUsedAt: new Date(now) }).where(eq(apiToken.id, row.id)).run();
	return {
		accountId: row.accountId,
		source,
		tokenId: row.id,
		scopes: new Set(cleanScopes(row.scopes)),
		habitIds: row.habitIds ? new Set(row.habitIds) : null
	};
}

/** The key sent with a request: `Authorization: Bearer itk_…`, or `?key=itk_…` for links. */
export function keyFrom(request: Request, url: URL): string | null {
	const auth = request.headers.get('authorization');
	const m = auth?.match(/^Bearer\s+(\S+)$/i);
	return m ? m[1] : url.searchParams.get('key');
}
