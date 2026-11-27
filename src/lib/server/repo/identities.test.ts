// Identities against a real (in-memory) database: two never read the same, an Undo of Delete included.
import { beforeAll, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { habitIdentity } from '../db/schema';
import { createAccount } from '../auth';
import { saveHabit } from './habits';
import { deleteIdentity, identityFor, listIdentities, restoreIdentity, unaddIdentity } from './identities';
import { habitForm } from '$lib/forms';

let me: string;
const today = '2026-11-22';

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('identities', 'correct horse battery');
});

it('Undo of a Delete, after one that says the same was added, gives that one the habits instead of a second', () => {
	const old = identityFor(me, 'I run');
	const h = saveHabit(me, null, habitForm.parse({ name: 'Run', direction: 'build', startDate: today, variants: [{ id: crypto.randomUUID(), name: 'Main', slots: [] }], schedule: { kind: 'group', target: null, minimum: null } }), today)!;
	db.insert(habitIdentity).values({ habitId: h, identityId: old }).run();
	const deleted = deleteIdentity(me, old)!;
	const now = identityFor(me, 'i run');
	expect(now).not.toBe(old);
	restoreIdentity(me, deleted);
	expect(listIdentities(me)).toEqual([{ id: now, statement: 'i run' }]);
	expect(db.select().from(habitIdentity).where(eq(habitIdentity.habitId, h)).all()).toEqual([{ habitId: h, identityId: now }]);
	// Then the Undo of that Add: the habit it has now came from the Delete's Undo, so it stays, with its habit.
	expect(unaddIdentity(me, now)).toBe(false);
	expect(listIdentities(me)).toEqual([{ id: now, statement: 'i run' }]);
	expect(db.select().from(habitIdentity).where(eq(habitIdentity.habitId, h)).all()).toEqual([{ habitId: h, identityId: now }]);
	// With no habit, the Undo of an Add takes it away.
	const empty = identityFor(me, 'I read');
	expect(unaddIdentity(me, empty)).toBe(true);
	expect(listIdentities(me).map((i) => i.statement)).toEqual(['i run']);
});
