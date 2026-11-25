// The measures an account starts from: what was written in code before measures were data, as
// formulas over the account's own field names. This is the one place that still looks for a weight,
// reps, a distance and a time among fields, and only to write those formulas once.
import { E1RM_PRESETS, type CustomMeasure } from './model';

export interface SeedField {
	taskId: string;
	name: string;
	type: string;
	unit: string | null;
	repeats: boolean;
}
export interface Roles<M> {
	weight: M | null;
	reps: M | null;
	distance: M | null;
	time: M | null;
}

export function rolesOf<M extends Omit<SeedField, 'taskId'>>(metrics: M[]): Roles<M> {
	const rep = metrics.filter((m) => m.repeats);
	const unit = (m: M) => (m.unit ?? '').trim().toLowerCase();
	const weight = rep.find((m) => m.type === 'number' && (['kg', 'lb', 'lbs'].includes(unit(m)) || /weight|load/i.test(m.name))) ?? null;
	const reps = rep.find((m) => m.type === 'count' && /rep/i.test(m.name)) ?? rep.find((m) => m.type === 'count') ?? null;
	const distance = metrics.find((m) => m.type === 'number' && (['km', 'mi', 'mile', 'miles', 'm'].includes(unit(m)) || /distance/i.test(m.name))) ?? null;
	const time = metrics.find((m) => m.type === 'duration') ?? null;
	return { weight, reps, distance, time };
}

/** Names in the order they are looked for: the plain one first, then the most used. */
function names(found: (SeedField | null)[], plain: string): string[] {
	const count = new Map<string, { name: string; n: number }>();
	for (const f of found) {
		const name = f?.name.trim();
		if (!name || /[[\]]/.test(name)) continue;
		const key = name.toLowerCase();
		count.set(key, { name: count.get(key)?.name ?? name, n: (count.get(key)?.n ?? 0) + 1 });
	}
	if (!count.size) return [plain];
	return [...count.values()].sort((a, b) => Number(b.name.toLowerCase() === plain.toLowerCase()) - Number(a.name.toLowerCase() === plain.toLowerCase()) || b.n - a.n).map((x) => x.name).slice(0, 8);
}
/** As many of them as fit in `max` letters, always the first. */
function within(xs: string[], max: number): string[] {
	let n = 0;
	return xs.filter((x, i) => (n += x.length + 4) <= max || !i);
}
/** The first of these fields a Task has. */
const anyOf = (all: string[], xs = within(all, 200)) => (xs.length === 1 ? `[${xs[0]}]` : `first(${xs.map((x) => `[${x}]`).join(', ')})`);

export interface Legacy {
	e1rm: string;
	e1rmMaxReps: number;
}

function found(metrics: SeedField[]) {
	const byTask = new Map<string, SeedField[]>();
	for (const m of metrics) byTask.set(m.taskId, [...(byTask.get(m.taskId) ?? []), m]);
	const roles = [...byTask.values()].map(rolesOf);
	const lifts = roles.filter((r) => r.weight && r.reps);
	const runs = roles.filter((r) => r.distance && r.time);
	return {
		weight: names(lifts.map((r) => r.weight), 'Weight'),
		reps: names(lifts.map((r) => r.reps), 'Reps'),
		distance: names(runs.map((r) => r.distance), 'Distance'),
		time: names(runs.map((r) => r.time), 'Time'),
		anyWeight: names(roles.map((r) => r.weight), 'Weight'),
		anyReps: names(roles.map((r) => r.reps), 'Reps')
	};
}

/** How the best lift is worked out from a set: `[Weight]` and `[Reps]` as they were typed, with their limits written out. */
function oneRep(formula: string, w: string, r: string, maxReps: number): string {
	return formula.replace(/\[\s*weight\s*\]/gi, `above(${w}, 0)`).replace(/\[\s*reps\s*\]/gi, `upto(atleast(${r}, 1), ${maxReps})`);
}

export function seedMeasures(metrics: SeedField[], legacy: Legacy = { e1rm: E1RM_PRESETS.epley.formula, e1rmMaxReps: 12 }): CustomMeasure[] {
	const f = found(metrics);
	const [w, r, d, t] = [anyOf(f.weight), anyOf(f.reps), anyOf(f.distance), anyOf(f.time)];
	return [
		{ id: 'volume', name: 'Volume', formula: `${w} * ${r}`, per: 'set', combine: 'sum', unit: '{weight}', read: 'shown', sets: true, weigh: true, record: 'Most volume in a session' },
		{ id: 'e1rm', name: 'Estimated 1RM', formula: oneRep(legacy.e1rm, w, r, legacy.e1rmMaxReps), per: 'set', combine: 'max', unit: '{weight}', read: 'shown', sets: true, over: 'max', record: 'Best estimated 1RM' },
		{ id: 'hardSets', name: 'Hard sets', formula: 'sets()', per: 'log', combine: 'sum', unit: 'sets', kind: 'count', weigh: true },
		{ id: 'pace', name: 'Pace', formula: `minutes(${t}) / ${d}`, per: 'log', combine: 'sum', unit: `min/[${within(f.distance, 200).join('|')}]`, better: 'less', over: 'avg' },
		{ id: 'heaviest', name: 'Heaviest set', formula: w, per: 'set', combine: 'max', unit: '{weight}', read: 'shown', sets: true, over: 'max', record: `Heaviest set (× [${within(f.reps, 200).join('|')}])` }
	];
}

/** An account's measures with the ones that were written in code before them, each once and under a name of its own. */
export function withSeeds(own: CustomMeasure[], metrics: SeedField[], legacy?: Legacy): CustomMeasure[] {
	const taken = new Set(own.map((m) => m.name.trim().toLowerCase()));
	const seeds = seedMeasures(metrics, legacy)
		.filter((m) => !own.some((x) => x.id === m.id))
		.map((m) => (taken.has(m.name.toLowerCase()) ? { ...m, name: `${m.name} (built-in)` } : m));
	return [...seeds, ...own.map((m) => spellOut(m, metrics))];
}

/** Other ways to work out the same thing, offered beside it. */
export function suggestions(metrics: SeedField[]): Record<string, { name: string; formula: string }[]> {
	const f = found(metrics);
	return { e1rm: Object.values(E1RM_PRESETS).map((p) => ({ name: p.name, formula: oneRep(p.formula, anyOf(f.weight), anyOf(f.reps), 12) })) };
}

/** A measure written when [Weight] and [Reps] meant a set's weight and reps whatever they were called: the names it found, written out. */
export function spellOut(m: CustomMeasure, metrics: SeedField[]): CustomMeasure {
	const f = found(metrics);
	const own = (list: string[], plain: string) => anyOf([plain, ...list.filter((x) => x.toLowerCase() !== plain.toLowerCase())]);
	const formula = m.formula.replace(/\[\s*weight\s*\]/gi, own(f.anyWeight, 'Weight')).replace(/\[\s*reps\s*\]/gi, own(f.anyReps, 'Reps'));
	return { ...m, formula: formula.length <= 1000 ? formula : m.formula };
}
