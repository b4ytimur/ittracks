// A Slot swapped mid-exercise: each set counts for the Task it was done with, and the swap names the plan's Task.
import { describe, expect, it } from 'vitest';
import { computeCard, insteadOf, prepare, type Ctx, type Dataset } from './engine';
import { emptyStats, makeCard } from './model';

const metric = (id: string, taskId: string) => ({ id, taskId, name: 'Weight', type: 'number', unit: 'kg', repeats: true, choices: null });
const task = (id: string, name: string) => ({ id, name, areaId: null, parentTaskId: null, archived: false, tags: [] });

function dataset(entries: [string, number][], picks: Record<string, string> | null): Dataset {
	return {
		today: '2026-11-27',
		ranges: [],
		areas: [],
		habits: [{ id: 'gym', name: 'Gym', direction: 'build', areaId: null, startDate: '2026-10-01', archived: false, identities: [], cost: null, streakRule: { kind: 'neverTwice' }, minimumCounts: true, limit: null }],
		tasks: [task('bench', 'Bench press'), task('incline', 'Incline bench press')],
		metrics: [metric('bkg', 'bench'), metric('ikg', 'incline')],
		variants: [{ id: 'push', habitId: 'gym', name: 'Push day A' }],
		slots: [{ id: 's1', variantId: 'push', taskId: 'bench', sets: 4, targets: { bkg: 60 }, minTargets: null, stretchTargets: null }],
		occurrences: [{ id: 'o1', habitId: 'gym', variantId: 'push', date: '2026-11-27', status: 'done', level: null, picks, time: null }],
		entries: entries.map(([taskId, kg], i) => ({ occurrenceId: 'o1', taskId, values: taskId === 'bench' ? { bkg: kg } : { ikg: kg }, sortOrder: i, path: 's1' })),
		slips: [],
		cravings: []
	};
}

describe('a swapped Slot in Stats', () => {
	it('counts sets done before the swap for the Task they were done with', () => {
		for (const order of [
			[['bench', 60], ['bench', 60], ['incline', 50], ['incline', 50]],
			[['incline', 50], ['bench', 60]]
		] as [string, number][][]) {
			const P = prepare(dataset(order, { s1: 'incline' }));
			const sets = (t: string) => (P.logsByTask.get(t) ?? []).flatMap((l) => l.sets);
			expect(sets('bench').every((v) => 'bkg' in v)).toBe(true);
			expect(sets('incline').every((v) => 'ikg' in v)).toBe(true);
			expect(sets('bench').length + sets('incline').length).toBe(order.length);
		}
	});

	it('counts a part done inside the Task before the swap for that part, not as a part of the Task swapped in', () => {
		const withPart = (picks: Record<string, string> | null) => {
			const ds = dataset([], picks);
			ds.tasks.push(task('pushup', 'Push-up'));
			ds.metrics.push({ ...metric('preps', 'pushup'), name: 'Reps', unit: null });
			ds.parts = [{ id: 'p1', taskId: 'bench', childTaskId: 'pushup', sets: 1, targets: null, minTargets: null, stretchTargets: null, archived: false }];
			ds.entries = [{ occurrenceId: 'o1', taskId: 'pushup', values: { preps: 10 }, sortOrder: 0, path: 's1/p1' }];
			return prepare(ds);
		};
		const swapped = withPart({ s1: 'incline' });
		expect(swapped.logsByTask.get('incline') ?? []).toEqual([]);
		expect(swapped.logsByTask.get('pushup')![0].sets).toEqual([{ preps: 10 }]);
		// Not swapped: the part counts for the Task it sits in.
		expect(withPart(null).logsByTask.get('bench')![0].subsDone).toBe(1);
	});

	it("names the plan's Task a swapped-in Task was done instead of; the one done before the swap, and an unswapped Slot, are plain", () => {
		const P = prepare(dataset([['bench', 60], ['incline', 50]], { s1: 'incline' }));
		expect(P.logsByTask.get('incline')![0].slot?.taskId).toBe('bench');
		expect(insteadOf(P.logsByTask.get('incline')![0], P)).toBe('Bench press');
		expect(insteadOf(P.logsByTask.get('bench')![0], P)).toBeNull();
		const plain = prepare(dataset([['bench', 60]], null));
		expect(insteadOf(plain.logsByTask.get('bench')![0], plain)).toBeNull();
	});

	it('Recent sessions of the Task swapped in say what it was done instead of', () => {
		const P = prepare(dataset([['incline', 50]], { s1: 'incline' }));
		const s = emptyStats();
		const ctx: Ctx = { today: '2026-11-27', boardRange: '30d', boardFilter: { areas: [], tags: [], habit: null, identity: null, direction: 'all' }, settings: { muscle: s.muscle, measures: [] } };
		const r = computeCard(makeCard({ what: { source: 'task', taskId: 'incline' }, perLog: 'sets', range: 'all', look: { chart: 'sessions', top: 5 } }), P, ctx);
		expect(r.sessions).toMatchObject([{ task: 'Incline bench press', instead: 'Bench press' }]);
	});
});
