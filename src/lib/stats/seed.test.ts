// What was written in code before measures were data has to count the same as formulas.
import { describe, expect, it } from 'vitest';
import { compile, countsSets, evaluate, formulaProblem, FormulaError, type Lookup } from './formula';
import { fits } from './engine';
import { E1RM_PRESETS, isCustom, measureOf, perLogOf, readStats, statsSettings } from './model';
import { checkStatsSettings } from '../rules/stats';
import { rolesOf, seedMeasures, spellOut, withSeeds, type SeedField } from './seed';

const f = (taskId: string, name: string, type = 'number', unit: string | null = null, repeats = true): SeedField => ({ taskId, name, type, unit, repeats });
const gym = [f('a', 'Weight', 'number', 'kg'), f('a', 'Reps', 'count'), f('b', 'Load'), f('b', 'Wdh', 'count'), f('c', 'Weight', 'number', 'kg', false), f('d', 'Distance', 'number', 'mi', false), f('d', 'Zeit', 'duration', null, false)];
const formula = (ms: ReturnType<typeof seedMeasures>, id: string) => ms.find((m) => m.id === id)!.formula;
const run = (src: string, values: Record<string, number | null>, sets: number | null = null) => {
	const n = compile(src);
	if (n instanceof FormulaError) throw n;
	const at: Lookup = (name) => (name in values ? values[name] : undefined);
	return evaluate(n, at, sets);
};

describe('the measures an account starts from', () => {
	it('name the fields it has', () => {
		const ms = seedMeasures(gym);
		expect(formula(ms, 'volume')).toBe('first([Weight], [Load]) * first([Reps], [Wdh])');
		expect(formula(ms, 'pace')).toBe('minutes([Zeit]) / [Distance]');
		expect(formula(seedMeasures([]), 'volume')).toBe('[Weight] * [Reps]');
		for (const m of ms) expect(formulaProblem(m.formula)).toBeNull();
		expect(statsSettings.safeParse({ measures: ms }).success).toBe(true);
	});
	it('1RM keeps its formula and its limits', () => {
		for (const p of Object.values(E1RM_PRESETS)) {
			const src = formula(seedMeasures(gym, { e1rm: p.formula, e1rmMaxReps: 10 }), 'e1rm');
			const old = compile(p.formula);
			for (const [w, r] of [[100, 5], [60, 10], [42.5, 1]]) expect(run(src, { Weight: w, Reps: r })).toBeCloseTo(evaluate(old as never, (n) => (n === 'Weight' ? w : r))!, 9);
			for (const [w, r] of [[100, 11], [0, 5], [100, 0], [100, null], [null, 5]] as const) expect(run(src, { Weight: w, Reps: r })).toBeNull();
		}
	});
	it('a Task has them only when it has the fields, logged per set', () => {
		const of = (id: string) => seedMeasures(gym).filter((m) => fits(m, gym.filter((x) => x.taskId === id))).map((m) => m.id);
		expect(of('a')).toEqual(['volume', 'e1rm', 'hardSets', 'heaviest']);
		expect(of('b')).toEqual(['volume', 'e1rm', 'hardSets', 'heaviest']);
		expect(of('c')).toEqual([]);
		expect(of('d')).toEqual(['pace']);
	});
	it('a measure of your own keeps the weight and reps it found under another name', () => {
		const m = { id: 'm', name: 'Tonnage', formula: '[weight] * [ Reps ] + [Extra]', per: 'set' as const, combine: 'sum' as const, unit: 'kg' };
		expect(spellOut(m, gym).formula).toBe('first([Weight], [Load]) * first([Reps], [Wdh]) + [Extra]');
		expect(spellOut(m, gym.filter((x) => x.taskId === 'a')).formula).toBe('[Weight] * [Reps] + [Extra]');
	});
	it('never clash with a measure that is there already', () => {
		const own = { id: 'x', name: 'volume', formula: '[Weight]', per: 'set' as const, combine: 'sum' as const, unit: '' };
		const ms = withSeeds([own, { ...own, id: 'pace', name: 'Mine' }], gym);
		expect(ms.map((m) => m.name)).toEqual(['Volume (built-in)', 'Estimated 1RM', 'Hard sets', 'Heaviest set', 'volume', 'Mine']);
		expect(checkStatsSettings(statsSettings.parse({ measures: ms })).filter((i) => i.severity === 'block')).toEqual([]);
	});
	it('stay short enough to be stored, however many names there are', () => {
		const many = Array.from({ length: 30 }, (_, i) => [f(`t${i}`, `${'Weight '.repeat(8)}${i}`, 'number', 'kg'), f(`t${i}`, `${'Reps '.repeat(11)}${i}`, 'count'), f(`t${i}`, `${'Distance '.repeat(6)}${i}`, 'number', 'km', false), f(`t${i}`, `${'Time '.repeat(11)}${i}`, 'duration', null, false)]).flat();
		const r = statsSettings.safeParse({ measures: seedMeasures(many, { e1rm: '[Weight] * [Reps] + [Weight] / [Reps]', e1rmMaxReps: 12 }) });
		expect(r.success).toBe(true);
		expect(checkStatsSettings(r.data!).filter((i) => i.severity === 'block')).toEqual([]);
	});
	it('are told apart from what a card counts by itself', () => {
		const ms = seedMeasures([]);
		expect(ms.map(perLogOf)).toEqual(['volume', 'e1rm', 'hardSets', 'pace', 'custom:heaviest']);
		for (const m of ms) expect(measureOf(perLogOf(m), ms)?.id).toBe(m.id);
		expect(isCustom('sets')).toBe(false);
		expect(measureOf('volume', [])).toBeNull();
	});
	it('are kept when stored, and not added twice', () => {
		const s = readStats({ seeded: true, measures: seedMeasures(gym).slice(1) });
		expect(s.seeded).toBe(true);
		expect(s.measures.map((m) => m.id)).not.toContain('volume');
	});
	it('still finds what the code found', () => {
		expect(rolesOf(gym.filter((x) => x.taskId === 'b')).weight?.name).toBe('Load');
		expect(rolesOf(gym.filter((x) => x.taskId === 'c')).weight).toBeNull();
	});
});

describe('what formulas can say', () => {
	it('first takes the first field the Task has, also when it is empty', () => {
		expect(run('first([A], [B])', { B: 2 })).toBe(2);
		expect(run('first([A], [B])', { A: null, B: 2 })).toBeNull();
		expect(formulaProblem('first(2)')).toMatch(/field names/);
	});
	it('limits leave a number out, never round it', () => {
		expect(run('above([A], 0)', { A: 0 })).toBeNull();
		expect(run('atleast([A], 1)', { A: 1 })).toBe(1);
		expect(run('upto([A], 12)', { A: 13 })).toBeNull();
		expect(formulaProblem('upto([A])')).toMatch(/a value and a limit/);
	});
	it('sets counts sets, or nothing', () => {
		expect(run('sets() * 2', {}, 3)).toBe(6);
		expect(run('sets()', {}, null)).toBeNull();
		expect(countsSets(compile('1 + sets()') as never)).toBe(true);
	});
});
