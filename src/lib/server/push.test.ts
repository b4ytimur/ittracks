// A reminder goes out once, at its own time when it has one, with its own words and buttons.
import { beforeAll, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './db';
import { createAccount } from './auth';
import { saveSettings } from './settings';
import { saveHabit } from './repo/habits';
import { runReminders, subscribe } from './push';
import { habitForm } from '$lib/forms';

const sent = vi.hoisted(() => [] as { title: string; body: string; actions: { action: string }[] }[]);
vi.mock('web-push', () => ({ default: { generateVAPIDKeys: () => ({ publicKey: 'a', privateKey: 'b' }), sendNotification: async (_: unknown, m: string) => void sent.push(JSON.parse(m)) } }));

let me: string;
const add = (name: string, o: object) => {
	const v = crypto.randomUUID();
	return saveHabit(me, null, habitForm.parse({ name, direction: 'build', startDate: '2026-11-01', remind: true, schedule: { kind: 'interval', every: 1, start: '2026-11-01', variantId: v }, variants: [{ id: v, name: 'Main', slots: [] }], ...o }), '2026-11-22');
};
beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('push', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC' });
	subscribe(me, { endpoint: 'https://example.invalid/1', keys: { p256dh: 'x', auth: 'y' } });
	add('Run', { cue: { time: '07:00', place: 'the park', afterHabitId: null, afterText: null, range: null }, reminder: { time: '17:45', text: 'Shoes on', minimum: true, snooze: false } });
	add('Read', { cue: { time: '07:00', place: 'bed', afterHabitId: null, afterText: null, range: null } });
});

it('at its own time, with its own words and buttons', async () => {
	const at = (t: string) => new Date(`2026-11-22T${t}:00Z`);
	await runReminders(at('07:00'));
	expect(sent.map((s) => [s.title, s.body, s.actions.map((a) => a.action)])).toEqual([['Read', '07:00 bed', ['done', 'snooze']]]);
	sent.length = 0;
	await runReminders(at('17:45'));
	expect(sent.map((s) => [s.title, s.body, s.actions.map((a) => a.action)])).toEqual([['Run', 'Shoes on', ['done']]]);
	await runReminders(at('17:46'));
	expect(sent).toHaveLength(1);
});
