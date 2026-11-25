// A pack is copied in, is yours from then on, and leaves behind only what something uses; the Undo of
// both is exact.
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { tag } from './db/schema';
import { createAccount } from './auth';
import { dropPack, takePack, undoPack } from './packs';
import { saveTask } from './repo/tasks';
import { getGroupings, getGroups, getKinds, getPacks, getTaskTypes, getUnits, saveSettings } from './settings';
import { patchSettings } from './settings-patch';
import { getStats, saveStats } from './stats';
import { PACKS, packProblems, PACKS_BEFORE } from '$lib/packs';
import { rowWords, taskForm } from '$lib/forms';
import { makeCard, newId } from '$lib/stats/model';
import { metricsFromType } from '$lib/task-types';

migrate(db, { migrationsFolder: './drizzle' });
let me: string;
let n = 0;
beforeEach(async () => {
	me = await createAccount(`packs-${n++}`, 'correct horse battery');
});
const state = () => JSON.stringify([getPacks(me), getKinds(me), getGroupings(me), getStats(me).measures, getTaskTypes(me), db.select({ name: tag.name, g: tag.grouping }).from(tag).where(eq(tag.accountId, me)).all().sort((a, b) => a.name.localeCompare(b.name))]);
const ok = <T,>(r: T | { error: string }) => {
	if ('error' in (r as object)) throw new Error((r as { error: string }).error);
	return r as T;
};
const task = (typeKey: string, tags: { name: string; level: number }[] = []) => {
	const type = getTaskTypes(me).find((t) => t.key === typeKey)!;
	return saveTask(me, null, taskForm.parse({ name: `T${newId()}`, restTimerEnabled: false, restTimerSeconds: 90, ...rowWords(), ...type.words, tags, parts: [], metrics: metricsFromType(type, getUnits(me)) }))!;
};

describe('starter packs', () => {
	it('a new account starts with none, and nothing that belongs to one kind of tracking', () => {
		expect(getPacks(me)).toEqual([]);
		expect(getKinds(me).map((k) => k.name)).toEqual(['Time']);
		expect(getGroupings(me).map((g) => g.name)).toEqual(['Tags']);
		expect(getStats(me).measures).toEqual([]);
		expect(getTaskTypes(me).map((t) => t.key)).toEqual(['count', 'timed', 'check']);
	});
	it('every pack can be taken, all at once, and each brings what it says', () => {
		expect(packProblems()).toEqual([]);
		for (const p of PACKS) ok(takePack(me, p.id));
		expect(getPacks(me)).toEqual(PACKS.map((p) => p.id));
		for (const p of PACKS) {
			for (const t of p.types) expect(getTaskTypes(me).some((x) => x.key === t.key)).toBe(true);
			for (const k of p.kinds) expect(getUnits(me).names()).toEqual(expect.arrayContaining(k.units.map((u) => u.name)));
			for (const g of p.groupings) for (const m of g.members) expect(getGroups(me).of(m).name).toBe(g.name);
		}
		expect(getUnits(me).factor('kg', 'lb')).toBeCloseTo(2.2046, 3);
	});
	it('taking one twice changes nothing more, and Undo is exact', () => {
		const before = state();
		const r = ok(takePack(me, 'gym'));
		const after = state();
		ok(takePack(me, 'gym'));
		expect(state()).toBe(after);
		expect(undoPack(me, r.undo)).toBe('');
		expect(state()).toBe(before);
	});
	it('taken out, what nothing uses goes, and Undo brings it back', () => {
		ok(takePack(me, 'gym'));
		const full = state();
		const r = ok(dropPack(me, 'gym'));
		expect(r.kept).toEqual([]);
		expect(getKinds(me).map((k) => k.name)).toEqual(['Time']);
		expect(getStats(me).measures).toEqual([]);
		expect(db.select().from(tag).where(eq(tag.accountId, me)).all()).toEqual([]);
		expect(undoPack(me, r.undo)).toBe('');
		expect(state()).toBe(full);
	});
	it('what something uses stays', () => {
		ok(takePack(me, 'gym'));
		task('strength', [{ name: 'chest', level: 3 }]);
		const s = getStats(me);
		saveStats(me, { ...s, boards: [{ id: 'b', name: 'B', cards: [makeCard({ what: { source: 'task' }, perLog: 'volume' })] }] as never });
		const r = ok(dropPack(me, 'gym'));
		expect(r.kept).toEqual(['Volume', 'Weight', 'Muscle groups']);
		expect(getUnits(me).factor('kg', 'lb')).not.toBeNull();
		expect(getStats(me).measures.map((m) => m.id)).toEqual(['volume']);
		expect(getTaskTypes(me).some((t) => t.key === 'strength')).toBe(false);
	});
	it('never takes the place of something of yours', () => {
		const kinds = getKinds(me);
		patchSettings(me, { set: { units: [...kinds, { id: 'mine', name: 'Weight', shown: 'stone', units: [{ id: 's', name: 'stone', per: 6.35, step: 0.5, also: [] }] }, { id: 'lb', name: 'Records', shown: 'lb', units: [{ id: 'l', name: 'lb', per: 1, step: 1, also: [] }] }] }, was: { units: kinds } });
		saveStats(me, { ...getStats(me), measures: [{ id: 'x', name: 'Volume', formula: '[Pages]', per: 'log', combine: 'sum', unit: '' }] });
		ok(takePack(me, 'gym'));
		expect(getUnits(me).kindOf('lb')?.name).toBe('Records');
		expect(getUnits(me).kindOf('kg')?.name).toBe('Weight');
		expect(getStats(me).measures.map((m) => m.name)).toEqual(['Volume', 'Volume (Gym)', 'Estimated 1RM', 'Hard sets', 'Heaviest set']);
	});
	it('an Undo leaves what was changed since', () => {
		const r = ok(takePack(me, 'running'));
		const kinds = getKinds(me);
		patchSettings(me, { set: { units: kinds.map((k) => (k.id === 'distance' ? { ...k, shown: 'mi' } : k)) }, was: { units: kinds } });
		expect(undoPack(me, r.undo)).toMatch(/changed since/);
		expect(getUnits(me).shown('distance')).toBe('mi');
	});
	it('an account from before packs has what used to be built in', () => {
		saveSettings(me, { packs: undefined, units: undefined, groupings: undefined, stats: {} });
		expect(getPacks(me)).toEqual(PACKS_BEFORE);
		expect(getTaskTypes(me).map((t) => t.key)).toEqual(['strength', 'bodyweight', 'cardio', 'study', 'count', 'timed', 'check']);
		expect(getUnits(me).names()).toHaveLength(9);
		expect(getStats(me).measures.map((m) => m.id)).toEqual(['volume', 'e1rm', 'hardSets', 'pace', 'heaviest']);
		// Its types can be deleted one by one, and stay deleted.
		const own = getTaskTypes(me).slice(0, 4);
		patchSettings(me, { set: { taskTypes: own.slice(1) }, was: { taskTypes: own } });
		expect(getTaskTypes(me).map((t) => t.key)).toEqual(['bodyweight', 'cardio', 'study', 'count', 'timed', 'check']);
	});
	it('a type brings its own words', () => {
		ok(takePack(me, 'music'));
		const type = getTaskTypes(me).find((t) => t.key === 'piece')!;
		expect({ ...rowWords(), ...type.words }).toEqual({ rowOne: 'take', rowMany: 'takes', betweenName: 'Break' });
		expect(metricsFromType(type, getUnits(me))[0].unit).toBe('bpm');
	});
});
