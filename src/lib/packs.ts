// Starter packs: what belongs to one kind of tracking. A pack is copied in and is yours from then
// on; taking it out removes only what nothing uses. A new account starts with none.
import { z } from 'zod';
import { groupingList, type Grouping } from './groupings';
import { compile, FormulaError } from './stats/formula';
import { customMeasure, type CustomMeasure } from './stats/model';
import { seedMeasures } from './stats/seed';
import { taskTypeSchema, type TaskType } from './task-types';
import { STARTER_KINDS, unitKinds, unitTable, unitWord, type Unit, type UnitKind } from './units';

export interface Pack {
	id: string;
	name: string;
	brings: string;
	kinds: UnitKind[];
	groupings: (Grouping & { members: string[] })[];
	measures: CustomMeasure[];
	types: TaskType[];
}

const kind = (id: string) => STARTER_KINDS.find((k) => k.id === id)!;
const measures = (...ids: string[]) => seedMeasures([]).filter((m) => ids.includes(m.id));
const unit = (name: string, per: number, step: number, also: string[] = []): Unit => ({ id: name, name, per, step, also });
const sets = { rowOne: 'set', rowMany: 'sets', betweenName: 'Rest' };

export const PACKS: Pack[] = [
	{
		id: 'gym',
		name: 'Gym',
		brings: 'Weight with kg and lb, muscle groups, volume, estimated 1RM, hard sets, and Tasks with weight and reps.',
		kinds: [kind('weight')],
		groupings: [
			{
				id: 'muscles',
				name: 'Muscle groups',
				one: 'muscle group',
				levels: [
					{ id: 3, name: 'high', weight: 1 },
					{ id: 2, name: 'medium', weight: 0.5 },
					{ id: 1, name: 'low', weight: 0 }
				],
				members: ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'core', 'quads', 'hamstrings', 'glutes', 'calves']
			}
		],
		measures: measures('volume', 'e1rm', 'hardSets', 'heaviest'),
		types: [
			{
				key: 'strength',
				name: 'Strength',
				description: 'Weight and reps for each set, with a rest timer',
				restTimerEnabled: true,
				words: sets,
				metrics: [
					{ name: 'Weight', type: 'number', unit: '{weight}', repeats: true, step: null },
					{ name: 'Reps', type: 'count', unit: '', repeats: true, step: 1, times: true }
				]
			},
			{ key: 'bodyweight', name: 'Bodyweight', description: 'Reps for each set', restTimerEnabled: true, words: sets, metrics: [{ name: 'Reps', type: 'count', unit: '', repeats: true, step: 1 }] }
		]
	},
	{
		id: 'running',
		name: 'Running',
		brings: 'Distance with km and mi, pace, and Tasks with time and distance.',
		kinds: [kind('distance')],
		groupings: [],
		measures: measures('pace'),
		types: [
			{
				key: 'cardio',
				name: 'Cardio',
				description: 'Time and distance',
				restTimerEnabled: false,
				metrics: [
					{ name: 'Time', type: 'duration', unit: 'min', repeats: false, step: 5 },
					{ name: 'Distance', type: 'number', unit: '{distance}', repeats: false, step: 0.5 }
				]
			}
		]
	},
	{
		id: 'music',
		name: 'Music practice',
		brings: 'Tempo in bpm, skills, and pieces you practise in takes.',
		kinds: [{ id: 'tempo', name: 'Tempo', shown: 'bpm', units: [unit('bpm', 1, 2)] }],
		groupings: [
			{
				id: 'skills',
				name: 'Skills',
				one: 'skill',
				levels: [
					{ id: 3, name: 'focus', weight: 1 },
					{ id: 2, name: 'some', weight: 0.5 },
					{ id: 1, name: 'warm-up', weight: 0 }
				],
				members: ['scales', 'sight-reading', 'rhythm', 'repertoire']
			}
		],
		measures: [],
		types: [
			{
				key: 'piece',
				name: 'Piece',
				description: 'A tempo for each take',
				restTimerEnabled: false,
				words: { rowOne: 'take', rowMany: 'takes', betweenName: 'Break' },
				metrics: [{ name: 'Tempo', type: 'number', unit: '{tempo}', repeats: true, step: 2 }]
			}
		]
	},
	{
		id: 'reading',
		name: 'Reading',
		brings: 'Books with pages and minutes.',
		kinds: [],
		groupings: [],
		measures: [],
		types: [
			{
				key: 'book',
				name: 'Book',
				description: 'Pages and minutes',
				restTimerEnabled: false,
				metrics: [
					{ name: 'Pages', type: 'count', unit: 'pages', repeats: false, step: 5 },
					{ name: 'Minutes', type: 'duration', unit: 'min', repeats: false, step: 5 }
				]
			}
		]
	},
	{
		id: 'study',
		name: 'Study',
		brings: 'Sessions with minutes and how many items.',
		kinds: [],
		groupings: [],
		measures: [],
		types: [
			{
				key: 'study',
				name: 'Study',
				description: 'Minutes and how many items',
				restTimerEnabled: false,
				metrics: [
					{ name: 'Minutes', type: 'duration', unit: 'min', repeats: false, step: 5 },
					{ name: 'Items', type: 'count', unit: '', repeats: false, step: 1 }
				]
			}
		]
	}
];
/** What an account that was there before packs has: what used to be built in. */
export const PACKS_BEFORE = ['gym', 'running', 'study'];
export const packById = (id: string) => PACKS.find((p) => p.id === id);

export const packState = z.object({
	packs: z.array(z.string().max(40)).max(40),
	units: unitKinds,
	groupings: groupingList,
	measures: z.array(customMeasure).max(60),
	taskTypes: z.array(taskTypeSchema).max(60)
});
export type PackState = z.infer<typeof packState>;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The account with a pack copied in. What it already has under the same name is left as it is. */
export function take(s: PackState, p: Pack): PackState {
	const taken = new Set(s.units.flatMap((k) => k.units.map((u) => unitWord(u.name))));
	let units = s.units.map((k) => {
		const mine = p.kinds.find((x) => x.id === k.id || same(x.name, k.name));
		if (!mine) return k;
		return { ...k, off: undefined, units: [...k.units.map((u) => (mine.units.some((x) => same(x.name, u.name)) ? { ...u, off: undefined } : u)), ...mine.units.filter((u) => !taken.has(unitWord(u.name)))] };
	});
	for (const k of p.kinds) {
		if (s.units.some((x) => x.id === k.id || same(x.name, k.name))) continue;
		const own = k.units.filter((u) => !taken.has(unitWord(u.name)));
		if (own.length) units = [...units, { ...k, units: own, shown: own.some((u) => same(u.name, k.shown)) ? k.shown : own[0].name }];
	}
	const groupings = [...s.groupings];
	for (const { members: _, ...g } of p.groupings) if (!groupings.some((x) => same(x.name, g.name))) groupings.push({ ...g, id: groupings.some((x) => x.id === g.id) ? `${g.id}-${groupings.length}` : g.id });
	const ms = s.measures.map((m) => (p.measures.some((x) => x.id === m.id) ? { ...m, off: undefined } : m));
	for (const m of p.measures) if (!ms.some((x) => x.id === m.id)) ms.push(ms.some((x) => same(x.name, m.name)) ? { ...m, name: `${m.name} (${p.name})` } : m);
	return {
		packs: [...s.packs.filter((x) => x !== p.id), p.id],
		units: clean(units),
		groupings,
		measures: clean(ms),
		taskTypes: [...s.taskTypes, ...p.types.filter((t) => !s.taskTypes.some((x) => x.key === t.key))]
	};
}
/** Without the keys that are undefined, as it is stored. */
const clean = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export interface Uses {
	/** Words fields are written in. */
	units: string[];
	/** How many cards count by a measure. */
	cards: (measureId: string) => number;
	/** How many Tasks have a member of a grouping. */
	tasks: (groupingId: string) => number;
}

/** The account without a pack, as far as nothing uses what it brought, and the names of what stays. */
export function drop(s: PackState, p: Pack, uses: Uses): { state: PackState; kept: string[] } {
	const kept: string[] = [];
	const gone = (id: string) => p.measures.some((m) => m.id === id);
	const ms = s.measures.filter((m) => {
		if (!gone(m.id)) return true;
		if (!uses.cards(m.id)) return false;
		kept.push(m.name);
		return true;
	});
	const table = unitTable(s.units);
	const units = s.units.filter((k) => {
		if (!p.kinds.some((x) => x.id === k.id)) return true;
		const read = uses.units.some((w) => table.kindOf(w)?.id === k.id) || ms.some((m) => m.unit.includes(`{${k.id}}`));
		if (read) kept.push(k.name);
		return read;
	});
	const groupings = s.groupings.filter((g, i) => {
		if (!p.groupings.some((x) => same(x.name, g.name))) return true;
		if (i === 0 || uses.tasks(g.id)) {
			kept.push(g.name);
			return true;
		}
		return false;
	});
	return { state: { packs: s.packs.filter((x) => x !== p.id), units, groupings, measures: ms, taskTypes: s.taskTypes.filter((t) => !p.types.some((x) => x.key === t.key)) }, kept };
}

/** Every pack's formulas read. */
export const packProblems = () => PACKS.flatMap((p) => p.measures.filter((m) => compile(m.formula) instanceof FormulaError).map((m) => `${p.name}: ${m.name}`));
