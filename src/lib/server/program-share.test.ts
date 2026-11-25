// Handing a program to someone else, after swarm round 5: the file names the starter packs its Tasks
// use and adding it takes the ones the other account lacks (with one Undo); adding asks when the
// plan starts, so a roster or a club plan doesn't restart on the day it is added.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { createAccount } from './auth';
import { getKinds, getPacks, saveSettings } from './settings';
import { missingPacks, takePack, takePacks, undoPack } from './packs';
import { userToday } from './today';
import { getHabitForm, saveHabit } from './repo/habits';
import { saveTask } from './repo/tasks';
import { addTemplate } from './repo/templates';
import { shareFile } from './share';
import { habitForm, taskForm } from '$lib/forms';
import { hasPlanStart, templateFile, type TemplateFile } from '$lib/template';
import { packsUsed } from '$lib/packs';
import { addDays } from '$lib/engine/dates';
import { db } from './db';

let coach: string;
let client: string;
let today: string;

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	coach = await createAccount('programcoach', 'correct horse battery');
	client = await createAccount('programclient', 'correct horse battery');
	for (const a of [coach, client]) saveSettings(a, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(coach);
	expect('undo' in takePack(coach, 'gym')).toBe(true);
});

const roundTrip = (f: TemplateFile | null) => templateFile.parse(JSON.parse(JSON.stringify(f)));
function habitWith(accountId: string, name: string, metrics: unknown[], tags: unknown[] = []) {
	const taskId = saveTask(accountId, null, taskForm.parse({ name: `${name} task`, restTimerEnabled: false, restTimerSeconds: 90, tags, metrics, parts: [] }))!;
	const v = randomUUID();
	return saveHabit(
		accountId,
		null,
		habitForm.parse({ name, direction: 'build', startDate: today, variants: [{ id: v, name: 'Main', slots: [{ id: randomUUID(), taskId, fillRule: null, sets: 3 }] }], schedule: { kind: 'interval', every: 1, start: today, variantId: v } }),
		today
	)!;
}

describe('a shared program brings its packs', () => {
	it('names the packs its units and tags come from, and only those', () => {
		expect(packsUsed(['gym', 'running'], [{ metrics: [{ unit: 'kg' }], tags: [] }])).toEqual(['gym']);
		expect(packsUsed(['gym', 'running'], [{ metrics: [{ unit: 'Kilometres' }], tags: [] }])).toEqual(['running']);
		expect(packsUsed(['gym'], [{ metrics: [{ unit: 'min' }], tags: [{ name: 'Chest' }] }])).toEqual(['gym']);
		expect(packsUsed(['gym'], [{ metrics: [{ unit: 'min' }], tags: [{ name: 'morning' }] }])).toEqual([]);
		// Only packs the person sharing has are named.
		expect(packsUsed([], [{ metrics: [{ unit: 'kg' }], tags: [] }])).toEqual([]);
	});

	it('takes the Gym pack on the other side with the habit, and its Undo takes it out again', () => {
		const squat = habitWith(coach, 'Squat day', [{ id: randomUUID(), name: 'Weight', type: 'number', unit: 'kg', repeats: true }], [{ name: 'quads', level: 3 }]);
		const walk = habitWith(coach, 'Walk', [{ id: randomUUID(), name: 'Minutes', type: 'duration', unit: 'min', repeats: false }]);
		const file = roundTrip(shareFile(coach, squat));
		expect(file.packs).toEqual(['gym']);
		expect(roundTrip(shareFile(coach, walk)).packs).toEqual([]);

		expect(missingPacks(client, file.packs).map((p) => p.name)).toEqual(['Gym']);
		const taken = takePacks(client, file.packs)!;
		expect(getPacks(client)).toEqual(['gym']);
		expect(getKinds(client).map((k) => k.name)).toContain('Weight');
		expect('error' in addTemplate(client, file, { today })).toBe(false);
		// Taken already: nothing more to take.
		expect(takePacks(client, file.packs)).toBeNull();
		expect(undoPack(client, taken)).toBe('');
		expect(getPacks(client)).toEqual([]);
	});
});

describe('adding a plan asks when it starts', () => {
	function roster() {
		const vs = ['Night 1', 'Night 2', 'Off 1'].map((name) => ({ id: randomUUID(), name, slots: [] }));
		const start = addDays(today, -20);
		return saveHabit(
			coach,
			null,
			habitForm.parse({ name: `Roster ${randomUUID().slice(0, 4)}`, direction: 'build', startDate: start, variants: vs, schedule: { kind: 'rotation', step: 'variant', order: vs.map((v) => ({ variantId: v.id, restDays: 0 })), onMiss: 'skip', weekdays: [], start } }),
			today
		)!;
	}

	it('a day before today puts you where the plan is now, with nothing before today', () => {
		const file = roundTrip(shareFile(coach, roster()));
		expect(hasPlanStart(file)).toBe(true);
		const r = addTemplate(client, file, { today, start: addDays(today, -1) });
		if ('error' in r) throw new Error(r.error);
		const f = getHabitForm(client, r.habitId)!;
		expect(f.startDate).toBe(today);
		expect((f.schedule as { start: string }).start).toBe(addDays(today, -1));
	});

	it('a day after today starts it then; without an answer it starts today', () => {
		const file = roundTrip(shareFile(coach, roster()));
		const later = addTemplate(client, file, { today, start: addDays(today, 6) });
		if ('error' in later) throw new Error(later.error);
		const f = getHabitForm(client, later.habitId)!;
		expect([f.startDate, (f.schedule as { start: string }).start]).toEqual([addDays(today, 6), addDays(today, 6)]);

		const plain = addTemplate(client, file, { today });
		if ('error' in plain) throw new Error(plain.error);
		expect((getHabitForm(client, plain.habitId)!.schedule as { start: string }).start).toBe(today);
	});

	it('is not asked of a habit on weekdays', () => {
		const v = randomUUID();
		const id = saveHabit(coach, null, habitForm.parse({ name: 'Stretch', direction: 'build', startDate: today, variants: [{ id: v, name: 'Main', slots: [] }], schedule: { kind: 'weekly', days: { 1: v, 3: v } } }), today)!;
		expect(hasPlanStart(roundTrip(shareFile(coach, id)))).toBe(false);
	});
});
