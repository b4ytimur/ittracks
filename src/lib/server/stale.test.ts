// Two devices with the same log open, against a real (in-memory) database and the log page's own action.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { entry, occurrence } from './db/schema';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { userToday } from './today';
import { saveHabit } from './repo/habits';
import { saveTask } from './repo/tasks';
import { habitForm, taskForm } from '$lib/forms';
import { revOf, type LogContent } from '$lib/logrev';
import { contentOf } from './stale';
import { actions } from '../../routes/(app)/log/[id]/+page.server';

let me: string;
let today: string;
let taskId: string;
let occ: string;
const weight = randomUUID();
const sets = (...kg: number[]) => kg.map((w) => ({ taskId, path: null, values: { [weight]: w } }));
const now = () => contentOf(db.select().from(occurrence).where(eq(occurrence.id, occ)).get()!);

/** One device: it holds what it loaded, and the fingerprints its log grew from. */
function device() {
	const rev = revOf(now());
	return {
		bases: [rev],
		async save(c: Partial<LogContent>, o: { finish?: boolean; bases?: string[] | null } = {}) {
			const bases = o.bases === undefined ? this.bases : o.bases;
			const payload = { finish: false, stay: true, notes: '', level: 'target', entries: [], ...c, ...(o.finish && { finish: true }), ...(bases && { bases }) };
			const body = new FormData();
			body.set('payload', JSON.stringify(payload));
			const event = { request: new Request('http://x/', { method: 'POST', body }), locals: { account: { id: me } }, params: { id: occ }, cookies: { get: () => undefined } };
			const r = (await (actions.save as unknown as (e: unknown) => Promise<unknown>)(event)) as { saved?: boolean; status?: number; data?: { stale: { rev: string } & LogContent } };
			return r.saved ? 'saved' : r.data!.stale;
		}
	};
}

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('stale', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	taskId = saveTask(
		me,
		null,
		taskForm.parse({ name: 'Bench press', restTimerEnabled: false, restTimerSeconds: 90, tags: [], metrics: [{ id: weight, name: 'Weight', type: 'number', unit: 'kg', repeats: true }], parts: [] })
	)!;
});
beforeEach(() => {
	const v = randomUUID();
	const habit = saveHabit(
		me,
		null,
		habitForm.parse({ name: 'Gym', direction: 'build', startDate: today, variants: [{ id: v, name: 'Main', slots: [{ id: randomUUID(), taskId, fillRule: null, sets: 3, targets: {} }] }], schedule: { kind: 'interval', every: 1, start: today, variantId: v } }),
		today
	)!;
	occ = randomUUID();
	db.delete(occurrence).where(eq(occurrence.habitId, habit)).run();
	db.insert(occurrence).values({ id: occ, habitId: habit, variantId: v, date: today, status: 'due' }).run();
});

describe('a save from a page that is out of date', () => {
	it('is refused, changes nothing, and hands back what is here', async () => {
		const phone = device();
		const laptop = device();
		expect(await phone.save({ entries: sets(60, 60) })).toBe('saved');
		const stale = await laptop.save({ entries: sets(70), notes: 'from the laptop' });
		expect(stale).toMatchObject({ rev: revOf(now()), entries: sets(60, 60), notes: '', level: 'target' });
		expect(now().entries).toEqual(sets(60, 60));
	});
	it('is refused as a Finish too, and the log stays open', async () => {
		const phone = device();
		const laptop = device();
		await phone.save({ entries: sets(60) });
		expect(await laptop.save({ entries: sets(70) }, { finish: true })).not.toBe('saved');
		expect(db.select().from(occurrence).where(eq(occurrence.id, occ)).get()!.status).toBe('due');
	});
	it('goes through once the person chose to keep theirs', async () => {
		const phone = device();
		const laptop = device();
		await phone.save({ entries: sets(60) });
		const stale = await laptop.save({ entries: sets(70) });
		expect(await laptop.save({ entries: sets(70) }, { bases: [(stale as { rev: string }).rev] })).toBe('saved');
		expect(now().entries).toEqual(sets(70));
	});
	it('counts anything else that wrote the log: a link, an assistant, an Undo that cleared it', async () => {
		const page = device();
		await page.save({ entries: sets(60) });
		page.bases = [revOf(now())];
		db.delete(entry).where(eq(entry.occurrenceId, occ)).run();
		expect(await page.save({ entries: sets(60, 60) })).not.toBe('saved');
	});
});

describe('a save that is not out of date', () => {
	it('goes on as you log, set after set', async () => {
		const phone = device();
		for (const kg of [[60], [60, 60], [60, 60, 55]]) {
			expect(await phone.save({ entries: sets(...kg) })).toBe('saved');
			phone.bases = [revOf({ entries: sets(...kg), notes: '', level: 'target' })];
		}
		expect(now().entries).toEqual(sets(60, 60, 55));
	});
	it('goes through when the answer to the one before never arrived', async () => {
		const phone = device();
		await phone.save({ entries: sets(60) }); // saved, but the phone lost the answer
		phone.bases.push(revOf({ entries: sets(60), notes: '', level: 'target' }));
		expect(await phone.save({ entries: sets(60, 60) })).toBe('saved');
	});
	it('can be sent twice, as the outbox may', async () => {
		const phone = device();
		expect(await phone.save({ entries: sets(60) })).toBe('saved');
		expect(await phone.save({ entries: sets(60) })).toBe('saved');
	});
	it('goes through without fingerprints, as one queued by an older version', async () => {
		const phone = device();
		await phone.save({ entries: sets(60) });
		expect(await device().save({ entries: sets(50) }, { bases: null })).toBe('saved');
	});
});
