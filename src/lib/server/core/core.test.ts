// The integration core against a real (in-memory) database: keys and scopes, every v1 action,
// the event log, and the analysis tools.
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { event, habit } from '../db/schema';
import { createAccount } from '../auth';
import { saveSettings } from '../settings';
import { userToday } from '../today';
import { addTemplate } from '../repo/templates';
import { galleryItem } from '$lib/gallery';
import { addDays } from '$lib/engine/dates';
import { appActor, type Actor } from './actor';
import { actorForKey, createKey, listKeys, revokeKey } from './tokens';
import { catalog, runAction } from './actions';

let me: string;
let app: Actor;
let today: string;
const ids: Record<string, string> = {};

const add = (slug: string, answers: Record<string, number | string | number[]> = {}) => {
	const r = addTemplate(me, galleryItem(slug)!.template, { today, answers });
	if ('error' in r) throw new Error(r.error);
	return r.habitId;
};
const run = (a: Actor, name: string, input: unknown = {}) => runAction(a, name, input) as Record<string, unknown>;
const events = () => db.select().from(event).where(eq(event.accountId, me)).all();

beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	me = await createAccount('tester', 'correct horse battery');
	saveSettings(me, { timeZone: 'UTC', dayStart: '00:00' });
	today = userToday(me);
	app = appActor(me);
	ids.water = add('drink-water', { glasses: 8 });
	ids.gym = add('beginner-5x5');
	ids.lang = add('language-daily', { mins: 20 });
	ids.smoke = add('quit-smoking');
	ids.read = add('reading', { pages: 10 });
	// Pretend water and reading were started two months ago, so past days can be logged.
	for (const h of [ids.water, ids.read, ids.smoke])
		db.update(habit).set({ startDate: addDays(today, -60), settledThrough: null }).where(eq(habit.id, h)).run();
});

describe('keys', () => {
	it('shows the secret once, keeps only a hash, and can be revoked', () => {
		const k = createKey(me, { name: 'Phone', scopes: ['log'], habitIds: [ids.water] });
		if ('error' in k) throw new Error(k.error);
		expect(k.secret).toMatch(/^itk_/);
		const listed = listKeys(me).find((x) => x.id === k.id)!;
		expect(listed.hint).toBe(k.secret.slice(0, 10));
		expect(JSON.stringify(listed)).not.toContain(k.secret.slice(10));
		const a = actorForKey(k.secret)!;
		expect(a.accountId).toBe(me);
		expect([...a.scopes]).toEqual(['log']);
		expect(actorForKey(k.secret + 'x')).toBeNull();
		expect(actorForKey('nope')).toBeNull();
		expect(revokeKey(me, k.id)).toBe(true);
		expect(actorForKey(k.secret)).toBeNull();
	});

	it('refuses an empty key, unknown habits, and no scopes', () => {
		expect(createKey(me, { name: ' ', scopes: ['read'], habitIds: null })).toHaveProperty('error');
		expect(createKey(me, { name: 'x', scopes: [], habitIds: null })).toHaveProperty('error');
		expect(createKey(me, { name: 'x', scopes: ['read'], habitIds: ['not-mine'] })).toHaveProperty('error');
	});

	it('enforces scopes and habit limits', () => {
		const k = createKey(me, { name: 'Water only', scopes: ['log', 'read'], habitIds: [ids.water] });
		if ('error' in k) throw new Error(k.error);
		const a = actorForKey(k.secret)!;
		expect(() => run(a, 'log_done', { habit: ids.read })).toThrow(/No habit/);
		expect(() => run(a, 'search_notes', {})).toThrow(/notes/);
		const d = run(a, 'describe') as { habits: { id: string }[] };
		expect(d.habits.map((h) => h.id)).toEqual([ids.water]);
		const readOnly = createKey(me, { name: 'Reader', scopes: ['read'], habitIds: null });
		if ('error' in readOnly) throw new Error(readOnly.error);
		expect(() => run(actorForKey(readOnly.secret)!, 'log_value', { habit: 'water', value: 1 })).toThrow(/can't log/);
		const cat = catalog(actorForKey(readOnly.secret)!);
		expect(cat.actions.some((x) => x.name === 'log_value')).toBe(false);
		expect(cat.actions.some((x) => x.name === 'series')).toBe(true);
	});
});

describe('logging', () => {
	it('adds water by name until the target finishes it, and logs events', () => {
		const before = events().length;
		let r = run(app, 'log_value', { habit: 'drink water', value: 3 });
		expect(r.status).toBe('due');
		expect(r.progress).toBe('3 of 8 glasses');
		r = run(app, 'log_value', { habit: 'Drink water', value: 2 });
		expect(r.progress).toBe('5 of 8 glasses');
		r = run(app, 'log_value', { habit: ids.water, value: 3 });
		expect(r.status).toBe('done');
		const types = events().slice(before).map((e) => e.type);
		expect(types).toEqual(['value.logged', 'value.logged', 'value.logged', 'occurrence.done']);
		r = run(app, 'log_value', { habit: 'water', value: 6, mode: 'set' });
		expect(r.progress).toBe('6 of 8 glasses');
	});

	it('names fields and refuses wrong types and per-set fields', () => {
		expect(() => run(app, 'log_value', { habit: 'Language practice', value: 5 })).toThrow(/Say which field/);
		const r = run(app, 'log_value', { habit: 'Language practice', field: 'new words', value: 12, finish: 'no' });
		expect(r.field).toBe('Language study: New words');
		expect(r.status).toBe('due');
		expect(() => run(app, 'log_value', { habit: 'Language practice', field: 'Minutes', value: 'lots' })).toThrow(/takes a number/);
	});

	it('logs gym sets by field name, and finishes when every Task is logged', () => {
		const t = run(app, 'today') as { build: { habitId: string; ref: string }[] };
		expect(t.build.some((b) => b.habitId === ids.gym)).toBe(true);
		const sets = Array.from({ length: 5 }, () => ({ weight: 60, reps: 5 }));
		let r = run(app, 'log_task', { habit: '5x5 strength', task: 'Squat', sets });
		expect(r.sets).toBe(5);
		expect(r.status).toBe('due');
		r = run(app, 'log_task', { habit: '5x5 strength', task: 'Bench press', sets: sets.slice(0, 3) });
		r = run(app, 'log_task', { habit: '5x5 strength', task: 'Bench press', sets: sets.slice(0, 2), replace: false });
		expect(r.sets).toBe(5);
		expect(() => run(app, 'log_task', { habit: '5x5 strength', task: 'Deadlift', sets })).toThrow(/no Task called “Deadlift”/);
		expect(() => run(app, 'log_task', { habit: '5x5 strength', task: 'Barbell row', values: { weight: 1 } })).toThrow(/per set/);
		r = run(app, 'log_task', { habit: '5x5 strength', task: 'Barbell row', sets });
		expect(r.status).toBe('done');
		const rec = run(app, 'record', { ref: `log:${r.occurrenceId}` }) as { values: { task: string; set: number | null; field: string; value: unknown }[] };
		expect(rec.values.filter((v) => v.task === 'Bench press' && v.field === 'Reps')).toHaveLength(5);
		expect(rec.values.find((v) => v.task === 'Squat' && v.set === 5 && v.field === 'Weight')?.value).toBe(60);
	});

	it('ticks steps, skips, undoes and marks done', () => {
		const r = run(app, 'log_task', { habit: 'Language practice', task: 'Language study', ticks: ['Review flashcards'], values: { Minutes: 20 }, replace: false, finish: 'no' });
		expect(r.progress).toMatch(/of 4 steps/);
		expect(run(app, 'log_skip', { habit: 'Language practice' }).status).toBe('skipped');
		expect(run(app, 'log_undo', { habit: 'Language practice' }).status).toBe('due');
		const d = run(app, 'log_done', { habit: 'Language practice', how: 'mark' });
		expect(d.status).toBe('done');
		expect(run(app, 'log_done', { habit: 'Language practice' }).already).toBe(true);
	});

	it('logs past days within the window, never the future or before the start', () => {
		const y = addDays(today, -1);
		const r = run(app, 'log_value', { habit: 'Read', date: y, field: 'Pages', value: 12 });
		expect(r.date).toBe(y);
		expect(r.status).toBe('done');
		expect(run(app, 'log_value', { habit: 'Read', date: 'yesterday', field: 'Pages', value: 1 }).progress).toBe('13 of 10 pages');
		expect(() => run(app, 'log_value', { habit: 'Read', date: addDays(today, 1), field: 'Pages', value: 1 })).toThrow(/future/);
		expect(() => run(app, 'log_task', { habit: '5x5 strength', date: addDays(today, -3), task: 'Squat', sets: [{ weight: 1, reps: 1 }] })).toThrow(/started on/);
		saveSettings(me, { pastDays: 0 });
		expect(() => run(app, 'log_value', { habit: 'Read', date: y, field: 'Pages', value: 1 })).toThrow(/off in Settings/);
		saveSettings(me, { pastDays: null });
	});

	it('logs and takes back slips and cravings on break habits', () => {
		const s = run(app, 'log_slip', { habit: 'Quit smoking', count: 2, feeling: 'Stressed' });
		expect(s.slipsThatDay).toBe(2);
		expect(() => run(app, 'log_slip', { habit: 'Read' })).toThrow(/build habit/);
		expect(() => run(app, 'log_value', { habit: 'Quit smoking', value: 1 })).toThrow(/break habit/);
		run(app, 'log_craving', { habit: 'Quit smoking' });
		expect(run(app, 'remove_slip', { slip: `slip:${s.slipId}` }).removed).toBe(`slip:${s.slipId}`);
		const types = events().map((e) => e.type);
		expect(types).toContain('slip.logged');
		expect(types).toContain('slip.removed');
		expect(types).toContain('craving.resisted');
	});

	it('writes notes only with the notes scope, and never puts note text in events', () => {
		run(app, 'write_day_note', { text: 'Slept badly, still trained.' });
		run(app, 'write_day_note', { text: 'Evening: better.', append: true });
		const hits = run(app, 'search_notes', { query: 'trained' }) as { rows: { ref: string; text: string }[] };
		expect(hits.rows[0].ref).toBe(`day:${today}`);
		expect(hits.rows[0].text).toContain('Evening: better.');
		expect(JSON.stringify(events())).not.toContain('Slept badly');
		const k = createKey(me, { name: 'No notes', scopes: ['read', 'log'], habitIds: null });
		if ('error' in k) throw new Error(k.error);
		expect(() => run(actorForKey(k.secret)!, 'write_day_note', { text: 'x' })).toThrow(/notes/);
	});

	it('checks input against the schema', () => {
		expect(() => run(app, 'log_value', { habit: 'water' })).toThrow(/value/);
		expect(() => run(app, 'nope')).toThrow(/No action/);
	});
});

describe('reading and analysis', () => {
	beforeAll(() => {
		// 30 days of water and reading that rise together, for correlation.
		for (let i = 2; i <= 31; i++) {
			const d = addDays(today, -i);
			run(app, 'log_value', { habit: 'water', date: d, value: (i % 7) + 2, finish: 'yes' });
			run(app, 'log_value', { habit: 'Read', date: d, field: 'Pages', value: (i % 7) * 3 + 1, finish: 'yes' });
		}
	});

	it('describes habits, Tasks, fields and units', () => {
		const d = run(app, 'describe') as { habits: { name: string; schedule: string }[]; tasks: { name: string; fields: { name: string; unit: string | null; perSet: boolean }[] }[] };
		expect(d.habits.map((h) => h.name)).toContain('5x5 strength');
		const squat = d.tasks.find((t) => t.name === 'Squat')!;
		expect(squat.fields.find((f) => f.name === 'Weight')).toMatchObject({ unit: 'kg', perSet: true });
	});

	it('lists every value as a tidy table, as JSON or CSV, without text unless notes are allowed', () => {
		const v = run(app, 'values', { habits: ['Read'], fields: ['Pages'], days: 40 }) as { rows: { ref: string; value: unknown }[]; total: number };
		expect(v.total).toBe(31);
		expect(v.rows[0].ref).toMatch(/^log:/);
		const csv = run(app, 'values', { habits: ['water'], days: 40, format: 'csv' }) as { csv: string };
		expect(csv.csv.split('\n')[0]).toBe('ref,date,weekday,habit,status,variant,level,task,set,round,field,type,unit,value,score');
		run(app, 'log_value', { habit: 'Read', field: 'Book', value: 'Dune', finish: 'no' });
		const k = createKey(me, { name: 'Values', scopes: ['read'], habitIds: null });
		if ('error' in k) throw new Error(k.error);
		const noText = run(actorForKey(k.secret)!, 'values', { habits: ['Read'], days: 2 }) as { rows: { field: string }[] };
		expect(noText.rows.some((r) => r.field === 'Book')).toBe(false);
		const withText = run(app, 'values', { habits: ['Read'], days: 2 }) as { rows: { field: string }[] };
		expect(withText.rows.some((r) => r.field === 'Book')).toBe(true);
	});

	it('works out a series with the Stats engine, and drills into the logs behind it', () => {
		const s = run(app, 'series', { source: 'field', fields: ['Water'], combine: 'sum', bucket: 'day', days: 7, drill: true }) as {
			series: { values: (number | null)[]; total: number }[];
			buckets: unknown[];
			drill: { ref: string }[];
			unit: string;
		};
		expect(s.buckets).toHaveLength(7);
		expect(s.series[0].values).toHaveLength(7);
		expect(s.drill[0].ref).toMatch(/^log:/);
		const c = run(app, 'series', { source: 'outcomes', measure: 'rate', combine: 'avg', bucket: 'all', days: 30, split: 'habit' }) as { unit: string; series: unknown[] };
		expect(c.unit).toBe('%');
		expect(c.series.length).toBeGreaterThan(0);
		expect(() => run(app, 'series', { source: 'outcomes', measure: 'volume' })).toThrow(/isn't a measure/);
	});

	it('correlates two measures and explains the result', () => {
		const r = run(app, 'correlate', {
			a: { source: 'field', fields: ['Water'] },
			b: { source: 'field', fields: ['Pages'] },
			days: 40
		}) as { result: { pearson: number; n: number; strength: string }; reading: string };
		expect(r.result.n).toBeGreaterThanOrEqual(30);
		expect(r.result.pearson).toBeGreaterThan(0.8);
		expect(r.result.strength).toBe('very strong');
		expect(r.reading).toMatch(/does not show that one causes/);
	});

	it('summarises habits and lists logs with refs', () => {
		const s = run(app, 'habit_summary', { days: 40, habits: ['Read'] }) as { habits: { done: number; rate: number | null }[] };
		expect(s.habits[0].done).toBeGreaterThan(0);
		const l = run(app, 'logs', { days: 3 }) as { rows: { ref: string; kind: string; summary?: string }[] };
		expect(l.rows.some((r) => r.kind === 'log' && r.summary?.includes('Squat'))).toBe(true);
		const day = run(app, 'record', { ref: `day:${today}` }) as { logs: unknown[]; dayNote?: string };
		expect(day.logs.length).toBeGreaterThan(0);
		expect(day.dayNote).toContain('Slept badly');
	});

	it('lists events after a sequence number', () => {
		const all = run(app, 'events', { limit: 500 }) as { events: { seq: number; source: string }[] };
		expect(all.events.length).toBeGreaterThan(10);
		const after = run(app, 'events', { after: all.events[5].seq }) as { events: { seq: number }[] };
		expect(after.events[0].seq).toBe(all.events[6].seq);
	});

	it('describes a measure statistically and flags unusual days', () => {
		run(app, 'log_value', { habit: 'water', date: addDays(today, -32), value: 40, finish: 'yes' });
		const d = run(app, 'stats_describe', { measure: { source: 'field', fields: ['Water'] }, days: 40 }) as {
			n: number;
			descriptives: { mean: number; meanCI95: [number, number]; median: number };
			unusual: { from: string; ref: string }[];
			reading: string;
			caveats: string[];
		};
		expect(d.n).toBeGreaterThanOrEqual(31);
		expect(d.descriptives.meanCI95[0]).toBeLessThan(d.descriptives.mean);
		expect(d.unusual.map((u) => u.from)).toContain(addDays(today, -32));
		expect(d.unusual[0].ref).toMatch(/^day:/);
		expect(d.reading).toMatch(/unusual day/);
	});

	it('finds a weekday pattern', () => {
		// Water was logged as (days ago mod 7) + 2: the same amount on each weekday.
		const g = run(app, 'stats_groups', { measure: { source: 'field', fields: ['Water'] }, by: 'weekday', from: addDays(today, -31), to: addDays(today, -2) }) as {
			groups: { label: string; n: number; sd: number | null }[];
			kruskalWallis: { p: number; size: string };
			reading: string;
		};
		expect(g.groups.map((x) => x.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
		expect(g.kruskalWallis.p).toBeLessThan(0.001);
		expect(g.kruskalWallis.size).toBe('large');
		expect(g.reading).toMatch(/the groups differ/);
	});

	it('tests a trend, a shift, and before vs after', () => {
		db.update(habit).set({ startDate: addDays(today, -60), settledThrough: null }).where(eq(habit.id, ids.lang)).run();
		// 15 days around 10 minutes, then 15 days around 25.
		for (let i = 31; i >= 2; i--)
			run(app, 'log_value', { habit: 'Language practice', date: addDays(today, -i), field: 'Minutes', value: (i > 16 ? 10 : 25) + ((i * 7) % 5) - 2, finish: 'yes' });
		const measure = { source: 'field', fields: ['Minutes'], habits: ['Language practice'] };
		const t = run(app, 'stats_trend', { measure, from: addDays(today, -31), to: addDays(today, -2) }) as {
			leastSquares: { slope: number; p: number };
			mannKendall: { p: number };
			changePoint: { from: string; shift: number; p: number };
			reading: string;
		};
		expect(t.leastSquares.slope).toBeGreaterThan(0);
		expect(t.mannKendall.p).toBeLessThan(0.01);
		expect(t.changePoint.from).toBe(addDays(today, -16));
		expect(t.changePoint.shift).toBeGreaterThan(10);
		expect(t.changePoint.p).toBeLessThan(0.01);
		const c = run(app, 'stats_compare', { measure, at: addDays(today, -16), days: 15 }) as {
			before: { n: number };
			after: { n: number };
			result: { meanDifference: number; welch: { p: number; diffCI95: [number, number] }; size: string };
			reading: string;
			caveats: string[];
		};
		expect(c.before.n).toBe(15);
		expect(c.after.n).toBe(15);
		expect(c.result.meanDifference).toBeCloseTo(15, 0);
		expect(c.result.welch.p).toBeLessThan(0.001);
		expect(c.result.welch.diffCI95[0]).toBeGreaterThan(10);
		expect(c.result.size).toBe('large');
		expect(c.caveats.join(' ')).toMatch(/not an experiment/);
		// Yes/no data is compared as two rates.
		const done = run(app, 'stats_compare', { measure: { source: 'outcomes', measure: 'rate', habits: ['water'] }, at: addDays(today, -16), days: 15 }) as {
			methods: string[];
			result: { proportions: { fisherP: number } | null };
		};
		expect(done.result.proportions).not.toBeNull();
		expect(done.methods.join(' ')).toMatch(/Fisher/);
		expect(() => run(app, 'stats_compare', { measure })).toThrow(/Send at/);
	});

	it('makes a JSON Schema for every action', () => {
		const c = catalog(app);
		expect(c.actions.length).toBe(31);
		for (const a of c.actions) expect(a.input).toHaveProperty('type', 'object');
	});
});

describe('export and import', () => {
	it('exports everything as JSON, and restores it into another account with new ids', async () => {
		const { exportJson, importReplace, readExport, exportCsvZip } = await import('./export');
		const file = JSON.parse(JSON.stringify(exportJson(app)));
		expect(file.format).toBe('ittracks-export');
		expect(file.includesNotes).toBe(true);
		expect(file.counts.habit).toBe(5);
		expect(file.counts.entry).toBeGreaterThan(50);
		expect(JSON.stringify(file)).not.toContain('passwordHash');
		expect(JSON.stringify(file)).not.toContain(me);
		const pre = readExport(file);
		expect('preview' in pre && pre.preview.counts.occurrence).toBe(file.counts.occurrence);
		expect(readExport({ format: 'ittracks-template' })).toHaveProperty('error');

		const other = await createAccount('second', 'another long password');
		const them = appActor(other);
		const r = importReplace(them, file);
		expect(r.renumbered).toBe(true);
		expect(r.counts.entry).toBe(file.counts.entry);
		const mine = run(app, 'values', { from: '2000-01-01', all: true }) as { total: number };
		const theirs = run(them, 'values', { from: '2000-01-01' }) as { total: number };
		expect(theirs.total).toBe(mine.total);
		const s1 = run(app, 'habit_summary', { days: 40, habits: ['Read'] }) as { habits: { done: number }[] };
		const s2 = run(them, 'habit_summary', { days: 40, habits: ['Read'] }) as { habits: { done: number }[] };
		expect(s2.habits[0].done).toBe(s1.habits[0].done);
		const notes = run(them, 'search_notes', { query: 'trained' }) as { rows: unknown[] };
		expect(notes.rows).toHaveLength(1);

		// Restoring into the same account keeps the ids, so links and Shortcuts keep working.
		const again = importReplace(app, file);
		expect(again.renumbered).toBe(false);
		expect((run(app, 'describe') as { habits: { id: string }[] }).habits.map((h) => h.id)).toContain(ids.water);

		// A key can't import, and an export without notes access leaves notes out.
		const k = createKey(me, { name: 'Backup', scopes: ['export'], habitIds: null });
		if ('error' in k) throw new Error(k.error);
		const noNotes = exportJson(actorForKey(k.secret)!);
		expect(noNotes.includesNotes).toBe(false);
		expect(noNotes.tables.dayNote).toEqual([]);
		expect(JSON.stringify(noNotes)).not.toContain('Slept badly');
		expect(() => importReplace(actorForKey(k.secret)!, file)).toThrow(/only be done in the app/);

		const z = exportCsvZip(app);
		const text = new TextDecoder().decode(z.body);
		expect(text).toContain('ittracks-export/values.csv');
		expect(text).toContain('ref,date,weekday,habit,status,variant,level,task,set,round,field,type,unit,value,score');
	});

	it("refuses a file that points at another account's rows", async () => {
		const { exportJson, importReplace } = await import('./export');
		const intruder = appActor(await createAccount('intruder', 'yet another long password'));
		const empty = JSON.parse(JSON.stringify(exportJson(intruder)));
		const before = (run(app, 'logs', { from: '2000-01-01', limit: 5000 }) as { total: number }).total;
		// A log on the first account's water habit, by its id.
		const crafted = { ...empty, tables: { ...empty.tables, occurrence: [{ id: crypto.randomUUID(), habitId: ids.water, date: addDays(today, -40), status: 'done' }] } };
		expect(() => importReplace(intruder, crafted)).toThrow(/points at a habit that isn't in the file/);
		expect((run(app, 'logs', { from: '2000-01-01', limit: 5000 }) as { total: number }).total).toBe(before);
	});
});
