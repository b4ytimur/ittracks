import { describe, expect, it } from 'vitest';
import { compile, evaluate, fieldsOf, formulaProblem, parse } from './formula';
import {
	autoBucket,
	bucketList,
	computeCard,
	describeLog,
	drill,
	prepare,
	previousRange,
	resolveRange,
	toCsv,
	type Ctx,
	type Dataset,
	type Prepared
} from './engine';
import { emptyStats, makeCard, readStats, type StatCardInput } from './model';
import { BOARD_TEMPLATES, boardTemplate, galleryCards, habitCards, headlineOptions, startingBoards, suggestedCards, taskCards, type BoardTemplateId } from './auto';
import { catalogOf, perLogChoices, statCtx } from './catalog';
import { checkCard, checkStatsSettings } from '../rules/stats';

const TODAY = '2026-11-21'; // a Saturday; the week started Monday 2026-11-16

function dataset(): Dataset {
	const habit = (id: string, name: string, direction: 'build' | 'break', extra: Partial<Dataset['habits'][number]> = {}) => ({
		id,
		name,
		direction,
		areaId: null,
		startDate: '2026-10-01',
		archived: false,
		identities: [],
		cost: null,
		streakRule: { kind: 'neverTwice' as const },
		minimumCounts: true,
		limit: null,
		...extra
	});
	const occ = (id: string, habitId: string, variantId: string, date: string, status: 'done' | 'missed' | 'due' | 'skipped', time: string | null = null, level: 'minimum' | 'target' | 'stretch' | null = null) => ({
		id,
		habitId,
		variantId,
		date,
		status,
		level,
		picks: null,
		time
	});
	const set = (w: number, r: number) => ({ w, r });
	return {
		today: TODAY,
		weightUnit: 'kg',
		ranges: [],
		areas: [{ id: 'a1', name: 'Fitness' }],
		habits: [
			habit('gym', 'Gym', 'build', { areaId: 'a1' }),
			habit('run', 'Run', 'build', { areaId: 'a1' }),
			habit('read', 'Read', 'build'),
			habit('smoke', 'Smoking', 'break', { startDate: '2026-11-01', cost: { amount: 1, unit: '€', perDay: 10 } })
		],
		tasks: [
			{ id: 'bench', name: 'Bench press', areaId: null, parentTaskId: null, archived: false, tags: [{ name: 'Chest', level: 3 }, { name: 'Triceps', level: 2 }, { name: 'Shoulders', level: 1 }] },
			{ id: 'runT', name: 'Easy run', areaId: null, parentTaskId: null, archived: false, tags: [] },
			{ id: 'book', name: 'Book', areaId: null, parentTaskId: null, archived: false, tags: [] },
			{ id: 'spanish', name: 'Spanish', areaId: null, parentTaskId: null, archived: false, tags: [] },
			{ id: 'podcast', name: 'Podcast', areaId: null, parentTaskId: null, archived: false, tags: [] },
			{ id: 'journal', name: 'Journal', areaId: null, parentTaskId: null, archived: false, tags: [] }
		],
		metrics: [
			{ id: 'w', taskId: 'bench', name: 'Weight', type: 'number', unit: 'kg', repeats: true, choices: null },
			{ id: 'r', taskId: 'bench', name: 'Reps', type: 'count', unit: null, repeats: true, choices: null },
			{ id: 'dist', taskId: 'runT', name: 'Distance', type: 'number', unit: 'km', repeats: false, choices: null },
			{ id: 'time', taskId: 'runT', name: 'Time', type: 'duration', unit: 'min', repeats: false, choices: null },
			{ id: 'mins', taskId: 'book', name: 'Minutes', type: 'duration', unit: 'min', repeats: false, choices: null },
			{ id: 'pages', taskId: 'book', name: 'Pages', type: 'count', unit: null, repeats: false, choices: null },
			{ id: 'smins', taskId: 'spanish', name: 'Minutes', type: 'duration', unit: 'h', repeats: false, choices: null },
			{ id: 'pmins', taskId: 'podcast', name: 'Minutes', type: 'count', unit: null, repeats: false, choices: null },
			{ id: 'mood', taskId: 'journal', name: 'Mood', type: 'choice', unit: null, repeats: false, choices: [{ id: 'good', name: 'good' }, { id: 'ok', name: 'ok' }, { id: 'bad', name: 'bad' }] },
			{ id: 'stretch', taskId: 'journal', name: 'Stretched', type: 'checkbox', unit: null, repeats: false, choices: null }
		],
		variants: [
			{ id: 'v1', habitId: 'gym', name: 'Push' },
			{ id: 'v2', habitId: 'run', name: 'Easy' },
			{ id: 'v3', habitId: 'read', name: 'Read' }
		],
		slots: [
			{ id: 's1', variantId: 'v1', taskId: 'bench', sets: 3, targets: { r: 8 }, minTargets: null, stretchTargets: null },
			{ id: 's2', variantId: 'v2', taskId: 'runT', sets: null, targets: null, minTargets: null, stretchTargets: null },
			{ id: 's3', variantId: 'v3', taskId: 'book', sets: null, targets: null, minTargets: null, stretchTargets: null },
			{ id: 's4', variantId: 'v3', taskId: 'spanish', sets: null, targets: null, minTargets: null, stretchTargets: null },
			{ id: 's5', variantId: 'v3', taskId: 'journal', sets: null, targets: null, minTargets: null, stretchTargets: null }
		],
		occurrences: [
			occ('g0', 'gym', 'v1', '2026-11-14', 'missed'),
			occ('g1', 'gym', 'v1', '2026-11-17', 'done', '18:30'),
			occ('g2', 'gym', 'v1', '2026-11-19', 'done', '07:15', 'stretch'),
			occ('g3', 'gym', 'v1', TODAY, 'due'),
			occ('r1', 'run', 'v2', '2026-11-18', 'done', '07:30'),
			occ('b0', 'read', 'v3', '2026-11-15', 'done', '22:00'),
			occ('b1', 'read', 'v3', '2026-11-20', 'done', '21:00')
		],
		entries: [
			{ occurrenceId: 'g1', taskId: 'bench', values: set(80, 8), sortOrder: 0 },
			{ occurrenceId: 'g1', taskId: 'bench', values: set(80, 8), sortOrder: 1 },
			{ occurrenceId: 'g1', taskId: 'bench', values: set(80, 6), sortOrder: 2 },
			{ occurrenceId: 'g2', taskId: 'bench', values: set(85, 8), sortOrder: 0 },
			{ occurrenceId: 'g2', taskId: 'bench', values: set(85, 8), sortOrder: 1 },
			{ occurrenceId: 'g2', taskId: 'bench', values: set(85, 8), sortOrder: 2 },
			{ occurrenceId: 'r1', taskId: 'runT', values: { dist: 5, time: 25 }, sortOrder: 0 },
			{ occurrenceId: 'b0', taskId: 'book', values: { mins: 20, pages: 10 }, sortOrder: 0 },
			{ occurrenceId: 'b1', taskId: 'book', values: { mins: 30, pages: 20 }, sortOrder: 0 },
			{ occurrenceId: 'b1', taskId: 'spanish', values: { smins: 0.25 }, sortOrder: 1 },
			{ occurrenceId: 'b0', taskId: 'journal', values: { mood: 'good', stretch: true }, sortOrder: 2 },
			{ occurrenceId: 'b1', taskId: 'journal', values: { mood: 'ok', stretch: false }, sortOrder: 2 }
		],
		slips: [{ habitId: 'smoke', date: '2026-11-10', count: 2, time: '21:00' }],
		cravings: [{ habitId: 'smoke', date: '2026-11-12', time: '15:00' }]
	};
}

const ctxOf = (over: Partial<Ctx> = {}): Ctx => {
	const s = emptyStats();
	return {
		today: TODAY,
		boardRange: '30d',
		boardFilter: { areas: [], tags: [], habit: null, identity: null, direction: 'all' },
		settings: { muscle: s.muscle, e1rm: s.e1rm, e1rmMaxReps: s.e1rmMaxReps, measures: [] },
		...over
	};
};

const run = (c: Omit<StatCardInput, 'id'>, P: Prepared = prepare(dataset()), ctx = ctxOf()) => computeCard(makeCard(c), P, ctx);

describe('formulas', () => {
	it('works out Epley the way the default e1RM does', () => {
		const n = parse('[Weight] * (1 + [Reps] / 30)');
		expect(evaluate(n, (f) => (f === 'Weight' ? 100 : 5))).toBeCloseTo(116.67, 2);
		expect(fieldsOf(n).sort()).toEqual(['Reps', 'Weight']);
	});

	it('follows the usual order of operations', () => {
		expect(evaluate(parse('2 + 3 * 4'), () => null)).toBe(14);
		expect(evaluate(parse('2 ^ 3 ^ 2'), () => null)).toBe(512);
		expect(evaluate(parse('-2 ^ 2'), () => null)).toBe(-4);
		expect(evaluate(parse('round(10 / 3, 1)'), () => null)).toBe(3.3);
		expect(evaluate(parse('max(1, 4, 2) × 2'), () => null)).toBe(8);
	});

	it('gives no number for a missing field or a division by zero, never a made-up 0', () => {
		expect(evaluate(parse('[A] / [B]'), (f) => (f === 'A' ? 1 : 0))).toBeNull();
		expect(evaluate(parse('[A] + 1'), () => null)).toBeNull();
		expect(evaluate(parse('sqrt(-1)'), () => null)).toBeNull();
	});

	it('says what is wrong in plain words', () => {
		expect(formulaProblem('weight * 2')).toMatch(/square brackets/);
		expect(formulaProblem('(1 + 2')).toMatch(/closing \)/);
		expect(formulaProblem('[Weight] [Reps]')).toMatch(/missing between/);
		expect(formulaProblem('1; drop table')).toMatch(/can't be used/);
		expect(formulaProblem('')).toMatch(/empty/);
		expect(formulaProblem('[Weight] * [Sets]', ['Weight', 'Reps'])).toBe('No number field called [Sets]');
		expect(formulaProblem('[weight] * [REPS]', ['Weight', 'Reps'])).toBeNull();
	});

	it('keeps parsed formulas', () => {
		expect(compile('1 + 1')).toBe(compile('1 + 1'));
	});
});

describe('ranges and buckets', () => {
	it('resolves calendar and rolling ranges', () => {
		expect(resolveRange('week', TODAY, '2026-01-01')).toEqual({ from: '2026-11-16', to: TODAY });
		expect(resolveRange('7d', TODAY, '2026-01-01')).toEqual({ from: '2026-11-15', to: TODAY });
		expect(resolveRange('month', TODAY, '2026-01-01')).toEqual({ from: '2026-11-01', to: TODAY });
		expect(resolveRange('12m', TODAY, '2026-01-01')).toEqual({ from: '2025-11-22', to: TODAY });
		expect(resolveRange('all', TODAY, '2026-03-04')).toEqual({ from: '2026-03-04', to: TODAY });
		expect(resolveRange('since:2026-11-10', TODAY, '2026-01-01')).toEqual({ from: '2026-11-10', to: TODAY });
	});

	it('compares with the same days of the period before', () => {
		expect(previousRange('week', { from: '2026-11-16', to: TODAY })).toEqual({ from: '2026-11-09', to: '2026-11-14' });
		expect(previousRange('month', { from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
		expect(previousRange('30d', { from: '2026-10-23', to: TODAY })).toEqual({ from: '2026-09-23', to: '2026-10-22' });
	});

	it('picks a bucket size from the range length', () => {
		expect(autoBucket({ from: '2026-11-01', to: '2026-11-30' })).toBe('day');
		expect(autoBucket({ from: '2026-08-01', to: '2026-11-30' })).toBe('week');
		expect(autoBucket({ from: '2025-11-01', to: '2026-11-30' })).toBe('month');
	});

	it('cuts the first and last bucket to the range', () => {
		const b = bucketList({ from: '2026-11-04', to: TODAY }, 'week');
		expect(b[0]).toMatchObject({ from: '2026-11-04', to: '2026-11-08' });
		expect(b.at(-1)).toMatchObject({ from: '2026-11-16', to: TODAY });
		expect(bucketList({ from: '2025-12-15', to: '2026-02-01' }, 'month').map((x) => x.label)).toEqual(['Dec 25', 'Jan 26', 'Feb 26']);
	});

	it('keeps the newest buckets on a long range', () => {
		const days = bucketList({ from: '2020-01-01', to: TODAY }, 'day');
		expect(days.at(-1)?.from).toBe(TODAY);
		expect(days.length).toBeGreaterThan(2000);
		expect(bucketList({ from: '2000-01-01', to: TODAY }, 'week').at(-1)?.to).toBe(TODAY);
	});
});

describe('habit outcomes', () => {
	it('counts done this week and compares with last week', () => {
		const r = run({ what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: 'week', compare: { previous: true } });
		expect(r.total).toBe(4); // gym twice, run, read
		expect(r.previousTotal).toBe(0); // Mon 9 to Sat 14: gym was missed, and Sunday the 15th is not in it
	});

	it('works out consistency from done and missed only', () => {
		const r = run({ what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', filter: { habits: ['gym'] } });
		expect(r.unit).toBe('%');
		expect(r.total).toBeCloseTo(66.67, 2);
	});

	it('counts target met from the targets, not just from done (swarm finding)', () => {
		// 80×8, 80×8, 80×6 reaches 8 reps in 2 of 3 sets: not met. 85×8 three times: met.
		// A day either met its target or not (round 3: half credit nobody could explain).
		const r = run({ what: { source: 'outcomes' }, perLog: 'targetMet', overTime: 'avg', filter: { habits: ['gym'] } });
		expect(r.total).toBe(50);
	});

	it('splits by level, with no level counting as Target', () => {
		const r = run({ what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', split: 'level', filter: { habits: ['gym'] }, look: { chart: 'breakdown' } });
		expect(r.breakdown!.map((x) => [x.label, x.value])).toEqual([
			['Target', 1],
			['Stretch', 1]
		]);
	});

	it('shows streaks for building habits and days clean for breaking ones', () => {
		const r = run({ what: { source: 'outcomes' }, perLog: 'done', look: { chart: 'streak' } });
		const smoke = r.streaks!.find((s) => s.habitId === 'smoke')!;
		expect(smoke).toMatchObject({ current: 11, best: 11, unit: 'days' });
		expect(smoke.strip.find((d) => d.date === '2026-11-10')!.status).toBe('slip');
		const slips = run({ what: { source: 'slips' }, perLog: 'count', look: { chart: 'streak' } });
		expect(slips.streaks!.map((s) => s.habitId)).toEqual(['smoke']);
	});
});

describe('Tasks', () => {
	it('adds up volume per week in the weight unit', () => {
		const r = run({ what: { source: 'task', taskId: 'bench' }, perLog: 'volume', overTime: 'sum', bucket: 'week', range: 'month', look: { chart: 'bars' } });
		expect(r.total).toBe(80 * 22 + 85 * 24);
		expect(r.series[0].values.at(-1)).toBe(3800);
		expect(r.unit).toBe('kg');
	});

	it('works out e1RM with the formula in settings, and only for low-rep sets', () => {
		const card = { what: { source: 'task' as const, taskId: 'bench' }, perLog: 'e1rm', overTime: 'max' as const };
		expect(run(card).total).toBeCloseTo(107.67, 2);
		const s = ctxOf();
		const brzycki = run(card, undefined, { ...s, settings: { ...s.settings, e1rm: '[Weight] * 36 / (37 - [Reps])' } });
		expect(brzycki.total).toBeCloseTo(105.52, 2);
		const capped = run(card, undefined, { ...s, settings: { ...s.settings, e1rmMaxReps: 5 } });
		expect(capped.total).toBeNull();
	});

	it('gives each tag its share of hard sets: high 1, medium 0.5, low 0', () => {
		const r = run({ what: { source: 'task' }, perLog: 'hardSets', overTime: 'sum', bucket: 'all', split: 'tag', look: { chart: 'bars' } });
		const by = Object.fromEntries(r.series.map((s) => [s.label, s.total]));
		expect(by).toEqual({ Chest: 6, Triceps: 3 });
		// The total counts each set once, not once per tag.
		expect(r.total).toBe(6);
	});

	it('works out pace as time over distance', () => {
		const r = run({ what: { source: 'task', taskId: 'runT' }, perLog: 'pace', overTime: 'avg' });
		expect(r.total).toBe(5);
		expect(r.unit).toBe('min/km');
	});

	it('runs your own measure on each set', () => {
		const s = ctxOf();
		const ctx = { ...s, settings: { ...s.settings, measures: [{ id: 'm1', name: 'Tonnage', formula: '[Weight] * [Reps]', per: 'set' as const, combine: 'sum' as const, unit: 'kg' }] } };
		const r = run({ what: { source: 'task', taskId: 'bench' }, perLog: 'custom:m1', overTime: 'sum' }, undefined, ctx);
		expect(r.total).toBe(3800);
		expect(r.unit).toBe('kg');
	});

	it('shows records and recent sessions', () => {
		const P = prepare(dataset());
		const rec = run({ what: { source: 'task', taskId: 'bench' }, perLog: 'e1rm', overTime: 'max', range: 'all', look: { chart: 'records' } }, P);
		expect(rec.records!.find((x) => x.label.startsWith('Heaviest'))).toMatchObject({ value: 85, date: '2026-11-19' });
		const ses = run({ what: { source: 'task', taskId: 'bench' }, perLog: 'sets', range: 'all', look: { chart: 'sessions', top: 5 } }, P);
		expect(ses.sessions!.map((s) => [s.date, s.text, s.met])).toEqual([
			['2026-11-19', '85 kg × 8, 8, 8', 1],
			['2026-11-17', '80 kg × 8, 8, 6', 0.5]
		]);
		expect(describeLog(P.logsByTask.get('runT')![0], P)).toBe('5 km · 25 min');
	});
});

describe('fields', () => {
	it('rolls up fields by name, converting units and leaving out ones that do not match', () => {
		const r = run({ what: { source: 'field', name: 'Minutes' }, perLog: 'value', overTime: 'sum' });
		expect(r.total).toBe(20 + 30 + 15); // 0.25 h is 15 min
		expect(r.notes.join(' ')).toMatch(/Minutes in Podcast .* was left out/);
	});

	it('counts each option of a choice field', () => {
		const r = run({ what: { source: 'field', metrics: ['mood'] }, perLog: 'option', overTime: 'count', split: 'option', look: { chart: 'breakdown' } });
		expect(r.breakdown!.map((x) => [x.label, x.value])).toEqual([
			['good', 1],
			['ok', 1]
		]);
	});

	it('averages a scored choice by its numbers (mood 5 to 1)', () => {
		const ds = dataset();
		ds.metrics = ds.metrics.map((m) => (m.id === 'mood' ? { ...m, scores: { good: 5, ok: 3, bad: 1 } } : m));
		const P = prepare(ds);
		const r = run({ what: { source: 'field', metrics: ['mood'] }, perLog: 'score', overTime: 'avg' }, P);
		expect(r.total).toBe(4);
		const catalog = catalogOf(P, { areas: [], identities: [] });
		expect(perLogChoices(makeCard({ what: { source: 'field', metrics: ['mood'] } }), catalog, [])).toEqual(['option', 'score']);
		const card = makeCard({ what: { source: 'field', metrics: ['mood'] }, perLog: 'score', overTime: 'avg' });
		expect(checkCard(card, statCtx(card, catalog))).toEqual([]);
		// Without numbers on the options, the number can't be read.
		const plain = catalogOf(prepare(dataset()), { areas: [], identities: [] });
		expect(checkCard(card, statCtx(card, plain)).map((i) => i.reason).join()).toMatch(/needs a Choice field with a number/);
		// Automatic cards chart the average next to the counts.
		const auto = taskCards(P, P.ds.tasks.find((t) => t.id === 'journal')!);
		expect(auto.filter((c) => c.what.metrics.includes('mood')).map((c) => c.perLog)).toEqual(['score', 'option']);
	});

	it('counts a renamed option under its new name, and reads each day by the numbers it had then', () => {
		const ds = dataset();
		ds.metrics = ds.metrics.map((m) =>
			m.id === 'mood'
				? {
						...m,
						// "good" was renamed Great; "ok" was removed after it was logged and a new "OK" added.
						choices: [{ id: 'good', name: 'Great' }, { id: 'ok2', name: 'OK' }, { id: 'ok', name: 'ok', archived: true }],
						scores: { good: 10, ok2: 6, ok: 6 },
						// Before the 18th the scale was 5 to 1.
						earlierScores: [{ until: '2026-11-17', scores: { good: 5, ok: 3 } }]
					}
				: m
		);
		const P = prepare(ds);
		const r = run({ what: { source: 'field', metrics: ['mood'] }, perLog: 'option', overTime: 'count', split: 'option', look: { chart: 'breakdown' } }, P);
		expect(r.breakdown!.map((x) => [x.label, x.value])).toEqual([
			['Great', 1],
			['OK', 1]
		]);
		// 15 Nov reads 5 (the old scale), 20 Nov reads 6 (today's).
		expect(run({ what: { source: 'field', metrics: ['mood'] }, perLog: 'score', overTime: 'avg' }, P).total).toBe(5.5);
	});

	it('shows a checkbox as the share of logs ticked', () => {
		const r = run({ what: { source: 'field', metrics: ['stretch'] }, perLog: 'ticked', overTime: 'avg' });
		expect(r.total).toBe(50);
	});

	it('splits a running total by Task and by weekday', () => {
		const r = run({ what: { source: 'field', name: 'Minutes' }, perLog: 'value', overTime: 'sum', bucket: 'all', split: 'weekday', look: { chart: 'bars' } });
		expect(r.series.map((s) => [s.label, s.total])).toEqual([
			['Fri', 45],
			['Sun', 20]
		]);
	});

	it('finds the logs behind a number', () => {
		const P = prepare(dataset());
		const card = makeCard({ what: { source: 'field', metrics: ['pages'] }, perLog: 'value', overTime: 'sum' });
		const rows = drill(card, P, ctxOf(), { from: '2026-11-16', to: TODAY }, null);
		expect(rows).toEqual([{ date: '2026-11-20', value: 20, occId: 'b1', habit: 'Read', task: 'Book', text: '30 min · 20' }]);
	});
});

describe('breaking habits', () => {
	it('counts money saved over finished days only', () => {
		const r = run({ what: { source: 'money' }, perLog: 'saved', overTime: 'sum', range: 'all' });
		expect(r.total).toBe(20 * 10 - 2); // Nov 1 to 20, minus two slips at 1 each
		expect(r.unit).toBe('€');
	});

	it('places slips on the weekday and part of the day grid', () => {
		const r = run({ what: { source: 'slips' }, perLog: 'count', overTime: 'sum', look: { chart: 'pattern' } });
		expect(r.grid!.values[1][3]).toBe(2); // Tuesday evening
	});

	it('scopes cards to the board filter', () => {
		const r = run({ what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum' }, undefined, ctxOf({ boardFilter: { areas: ['a1'], tags: [], habit: null, identity: null, direction: 'all' } }));
		expect(r.total).toBe(3); // gym twice and run; read has no area
	});
});

describe('auto cards and templates', () => {
	const P = prepare(dataset());
	const catalog = catalogOf(P, { areas: [{ id: 'a1', name: 'Fitness', icon: '', color: '' }], identities: [] });
	const blocks = (c: ReturnType<typeof makeCard>) => checkCard(c, statCtx(c, catalog)).filter((i) => i.severity === 'block');

	it('builds a gym habit tab with e1RM, volume and records', () => {
		const titles = habitCards(P, P.habits.get('gym')!).map((c) => c.title);
		expect(titles).toEqual(expect.arrayContaining(['Streak', 'Target met', 'Bench press: estimated 1RM', 'Bench press: volume per week']));
		expect(habitCards(P, P.habits.get('smoke')!).map((c) => c.title)).toContain('Money saved');
	});

	it('offers headline numbers from the habit fields', () => {
		expect(headlineOptions(P, P.habits.get('read')!).map((o) => o.label)).toEqual(expect.arrayContaining(['Minutes this week', 'Pages so far']));
	});

	it('starts with Overview, plus the board for the view template', () => {
		expect(startingBoards(P, 'standard').map((b) => b.name)).toEqual(['Overview']);
		expect(startingBoards(P, 'gym').map((b) => b.name)).toEqual(['Overview', 'Gym']);
	});

	it('never builds a card the rules would block', () => {
		const all = [
			...(Object.keys(BOARD_TEMPLATES) as BoardTemplateId[]).flatMap((id) => boardTemplate(id, P).cards),
			...galleryCards().flatMap((g) => g.cards),
			...suggestedCards(P).flatMap((g) => g.cards),
			...P.ds.habits.flatMap((h) => headlineOptions(P, h).map((o) => o.card))
		];
		expect(all.length).toBeGreaterThan(30);
		for (const c of all) expect(blocks(c), c.title).toEqual([]);
		// And each one works out without throwing.
		for (const c of all) computeCard(c, P, ctxOf());
	});

	it('offers only the measures that fit a field', () => {
		const m = (metrics: string[]) => perLogChoices(makeCard({ what: { source: 'field', metrics } }), catalog, []);
		expect(m(['mood'])).toEqual(['option']);
		expect(m(['w'])).toEqual(['sum', 'best', 'avg', 'sets']);
		expect(m(['pages'])).toEqual(['value']);
	});
});

describe('stats rules', () => {
	const P = prepare(dataset());
	const catalog = catalogOf(P, { areas: [], identities: [] });
	const issues = (c: Omit<StatCardInput, 'id'>) => {
		const card = makeCard(c);
		return checkCard(card, statCtx(card, catalog)).map((i) => `${i.path}: ${i.reason}`);
	};

	it('refuses to stack averages or keep a running total of one', () => {
		expect(issues({ what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', split: 'habit', look: { chart: 'bars', stacked: true } })).toContain(
			"look.stacked: Stacked averages don't add up to anything: show the series side by side"
		);
	});

	it('refuses to add up checkboxes and choices', () => {
		expect(issues({ what: { source: 'field', metrics: ['stretch'] }, perLog: 'value' }).join()).toMatch(/Checkbox fields can be counted/);
		expect(issues({ what: { source: 'field', metrics: ['mood'] }, perLog: 'value' }).join()).toMatch(/Choice fields can be counted per option/);
	});

	it('keeps tiles and calendars to one value', () => {
		expect(issues({ what: { source: 'outcomes' }, perLog: 'done', split: 'habit', look: { chart: 'tile' } }).join()).toMatch(/A number tile and a calendar show one value/);
	});

	it('needs weight and reps for volume', () => {
		expect(issues({ what: { source: 'task', taskId: 'runT' }, perLog: 'volume' }).join()).toMatch(/Volume and e1RM need/);
		expect(issues({ what: { source: 'task', taskId: 'bench' }, perLog: 'volume', overTime: 'sum' })).toEqual([]);
	});

	it('flags a deleted measure and a broken e1RM formula', () => {
		expect(issues({ what: { source: 'task', taskId: 'bench' }, perLog: 'custom:gone' }).join()).toMatch(/fix it under Your measures/);
		expect(checkStatsSettings({ ...emptyStats(), e1rm: '[Weight] * 2' }).map((i) => i.reason)).toContain('The e1RM formula needs [Weight] and [Reps]');
		expect(checkStatsSettings(emptyStats())).toEqual([]);
	});
});

describe('storage', () => {
	it('drops a broken card without losing the board', () => {
		const good = makeCard({ title: 'Done' });
		const s = readStats({ boards: [{ id: 'b', name: 'Mine', cards: [good, { id: 'x', look: { chart: 'pie' } }] }], e1rm: 7 });
		expect(s.boards[0].cards.map((c) => c.title)).toEqual(['Done']);
		expect(s.e1rm).toBe(emptyStats().e1rm);
	});

	it('writes CSV a spreadsheet will not run as a formula', () => {
		expect(toCsv([['=HYPERLINK("x")', '-3', 'a,b']])).toBe(`"'=HYPERLINK(""x"")",-3,"a,b"\n`);
	});
});

describe('auto card ids', () => {
	it('stay the same between page loads, so edits and downloads find them', () => {
		const P = prepare(dataset());
		const a = habitCards(P, P.habits.get('gym')!).map((c) => c.id);
		const b = habitCards(prepare(dataset()), P.habits.get('gym')!).map((c) => c.id);
		expect(a).toEqual(b);
		expect(new Set(a).size).toBe(a.length);
	});
});
