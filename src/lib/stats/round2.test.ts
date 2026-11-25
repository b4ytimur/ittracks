// Stats cards the second swarm test found wrong. A small dataset of its own, so the
// numbers below can be checked by hand.
import { seedMeasures } from './seed';
import { describe, expect, it } from 'vitest';
import { computeCard, prepare, unitOf, type Ctx, type Dataset, type DsHabit } from './engine';
import { duration } from './format';
import { emptyStats, makeCard, type StatCardInput } from './model';

const TODAY = '2026-11-21'; // a Saturday; the week started Monday 2026-11-16

function dataset(): Dataset {
	const habit = (id: string, name: string, direction: 'build' | 'break', extra: Partial<DsHabit> = {}): DsHabit => ({
		id,
		name,
		direction,
		areaId: null,
		startDate: '2026-10-01',
		archived: false,
		identities: [],
		cost: null,
		streakRule: { kind: 'neverTwice' },
		minimumCounts: true,
		limit: null,
		...extra
	});
	const occ = (id: string, habitId: string, variantId: string, date: string) => ({
		id,
		habitId,
		variantId,
		date,
		status: 'done' as const,
		level: null,
		picks: null,
		time: null
	});
	const task = (id: string, name: string) => ({ id, name, areaId: null, parentTaskId: null, archived: false, tags: [] });
	const metric = (id: string, taskId: string, name: string, type: string, unit: string | null) => ({ id, taskId, name, type, unit, repeats: false, choices: null });
	const slot = (id: string, variantId: string, taskId: string) => ({ id, variantId, taskId, sets: null, targets: null, minTargets: null, stretchTargets: null });
	const e = (occurrenceId: string, taskId: string, values: Record<string, unknown>, sortOrder: number) => ({ occurrenceId, taskId, values, sortOrder });
	return {
		today: TODAY,
		ranges: [],
		areas: [],
		habits: [
			habit('read', 'Read', 'build'),
			habit('run', 'Run', 'build'),
			habit('smoke', 'Smoking', 'break', { startDate: '2026-11-18', cost: { amount: 0.5, unit: '€', perDay: 20 } })
		],
		tasks: [task('book', 'Book'), task('yoga', 'Yoga'), task('study', 'Study'), task('journal', 'Journal'), task('runT', 'Easy run')],
		metrics: [
			// A duration that names no unit: the log screen shows it in minutes.
			metric('mins', 'book', 'Minutes', 'duration', null),
			metric('ymins', 'yoga', 'Minutes', 'duration', 'min'),
			metric('hrs', 'study', 'Hours', 'number', 'h'),
			metric('stretch', 'journal', 'Stretched', 'checkbox', null),
			metric('time', 'runT', 'Time', 'duration', 'min')
		],
		variants: [
			{ id: 'vr', habitId: 'read', name: 'Read' },
			{ id: 'vn', habitId: 'run', name: 'Easy' }
		],
		slots: [
			// Reading in the morning and at night: one Task in two Slots.
			slot('s1', 'vr', 'book'),
			slot('s2', 'vr', 'book'),
			slot('s3', 'vr', 'journal'),
			slot('s4', 'vr', 'study'),
			slot('s5', 'vr', 'yoga'),
			slot('s6', 'vn', 'runT')
		],
		occurrences: [occ('r1', 'read', 'vr', '2026-11-19'), occ('r2', 'read', 'vr', '2026-11-20'), occ('n0', 'run', 'vn', '2026-11-10'), occ('n1', 'run', 'vn', '2026-11-18'), occ('n2', 'run', 'vn', '2026-11-20')],
		entries: [
			e('r1', 'book', { mins: 20 }, 0),
			e('r1', 'book', { mins: 30 }, 1),
			e('r1', 'journal', { stretch: true }, 2),
			e('r1', 'study', { hrs: 1.5 }, 3),
			// The box was left unticked on the 20th, so nothing was saved for it.
			e('r2', 'book', { mins: 10 }, 0),
			e('r2', 'yoga', { ymins: 15 }, 4),
			e('n0', 'runT', { time: 28 }, 0),
			e('n1', 'runT', { time: 30 }, 0),
			e('n2', 'runT', { time: 25 }, 0)
		],
		slips: [{ habitId: 'smoke', date: '2026-11-19', count: 4, time: null }],
		cravings: []
	};
}

const ctx: Ctx = (() => {
	const s = emptyStats();
	return {
		today: TODAY,
		boardRange: '30d',
		boardFilter: { areas: [], tags: [], habit: null, identity: null, direction: 'all' },
		settings: { muscle: s.muscle, measures: seedMeasures(dataset().metrics) }
	};
})();

const P = prepare(dataset());
const run = (c: Omit<StatCardInput, 'id'>) => computeCard(makeCard(c), P, ctx);

describe('stats cards found wrong in the second swarm test', () => {
	it('keeps two Slots of one Task apart and adds both up', () => {
		const book = P.logsByTask.get('book')!;
		expect(book.map((l) => [l.occ.id, l.slot?.id, l.single.mins])).toEqual([
			['r1', 's1', 20],
			['r1', 's2', 30],
			['r2', 's1', 10]
		]);
		expect(run({ what: { source: 'field', metrics: ['mins'] }, perLog: 'value', overTime: 'sum' }).total).toBe(60);
	});

	it('adds a duration with no unit to one in minutes', () => {
		const r = run({ what: { source: 'field', name: 'Minutes' }, perLog: 'value', overTime: 'sum' });
		expect(r.total).toBe(20 + 30 + 10 + 15);
		expect(r.notes.join(' ')).not.toMatch(/left out/);
	});

	it('shows a number field in hours as a time, not as minutes', () => {
		const card = makeCard({ what: { source: 'field', metrics: ['hrs'] }, perLog: 'value', overTime: 'sum' });
		expect(unitOf(card, P, ctx)).toMatchObject({ unit: 'min', kind: 'duration' });
		expect(computeCard(card, P, ctx).total).toBe(90);
	});

	it('counts a box left unticked, which is never saved', () => {
		const r = run({ what: { source: 'field', metrics: ['stretch'] }, perLog: 'ticked', overTime: 'avg' });
		expect(r.total).toBe(50);
	});

	it('counts each Slot of a Task used twice that left its box unticked', () => {
		const ds = dataset();
		ds.slots.push({ id: 's7', variantId: 'vr', taskId: 'journal', sets: null, targets: null, minTargets: null, stretchTargets: null });
		const card = makeCard({ what: { source: 'field', metrics: ['stretch'] }, perLog: 'ticked', overTime: 'avg' });
		// Ticked once on the 19th, out of two planned boxes that day and two on the 20th.
		expect(computeCard(card, prepare(ds), ctx).total).toBe(25);
	});

	it('takes the smallest number as the record on a Lowest card', () => {
		const r = run({ what: { source: 'field', metrics: ['time'] }, perLog: 'value', overTime: 'min', range: 'all', look: { chart: 'records' } });
		expect(r.records![0]).toMatchObject({ label: 'Best log', value: 25, date: '2026-11-20' });
	});

	it('counts money saved at what each one costs', () => {
		const r = run({ what: { source: 'money' }, perLog: 'saved', overTime: 'sum', range: 'all' });
		// Nov 18 to 20 at 20 a day, less the 4 smoked on the 19th, at 0.50 each.
		expect(r.total).toBe((20 * 3 - 4) * 0.5);
	});

	it('measures a goal over the whole range unless a bucket size is picked', () => {
		const whole = run({ what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: '30d', compare: { goal: 10 }, look: { chart: 'goal' } });
		expect(whole.goalRows![0]).toMatchObject({ value: 5, goal: 10, period: 'in the last 30 days' });
		const week = run({ what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: '30d', bucket: 'week', compare: { goal: 10 }, look: { chart: 'goal' } });
		expect(week.goalRows![0]).toMatchObject({ value: 4, period: 'this week' });
	});

	it('keeps the seconds of a short time', () => {
		expect(duration(0.75)).toBe('45 s');
		expect(duration(1.5)).toBe('1 min 30 s');
		expect(duration(30)).toBe('30 min');
		expect(duration(125)).toBe('2 h 5 min');
	});
});
