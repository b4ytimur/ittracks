// Cards nobody has to build (A1) and whole boards in one tap (A2).
// Auto cards come from the type of each field a habit or Task logs; board templates pick
// the habits and Tasks that fit them from what the account already has.
import { makeCard, MAX_CARDS, newId, perLogOf, type Board, type CustomMeasure, type StatCard, type StatCardInput } from './model';
import { PACKS } from '../packs';
import { measuresOf } from './catalog-of';
import { compile, fieldsOf, FormulaError } from './formula';
import { fits, groupsOf, type DsHabit, type DsMetric, type DsTask, type Prepared } from './engine';
import { counts } from '../engine/scoring';

type In = Omit<StatCardInput, 'id'>;
const card = (c: In): StatCard => makeCard(c);

/** A short hash, so auto cards get the same id every time they are built. */
function hash(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}
const stable = (scope: string, cards: StatCard[]) => {
	const seen = new Map<string, number>();
	return cards.map((c) => {
		const base = `auto-${hash(`${scope}|${c.title}|${c.look.chart}|${c.what.source}|${c.perLog}`)}`;
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		return { ...c, id: n ? `${base}-${n}` : base };
	});
};

/** Fixed Tasks a habit's Variants use, in order, without repeats. */
export function habitTasks(P: Prepared, habitId: string): DsTask[] {
	const seen = new Set<string>();
	const out: DsTask[] = [];
	for (const v of P.ds.variants.filter((x) => x.habitId === habitId))
		for (const s of P.slotsByVariant.get(v.id) ?? []) {
			const t = s.taskId ? P.tasks.get(s.taskId) : undefined;
			if (t && !seen.has(t.id)) {
				seen.add(t.id);
				out.push(t);
			}
		}
	// Tasks picked into open Slots show up in logs only.
	for (const l of P.logs)
		if (l.habit.id === habitId && !seen.has(l.task.id)) {
			seen.add(l.task.id);
			out.push(l.task);
		}
	return out;
}

/** A Yes or no Task: nothing to fill in and no steps, so its tick is the target. */
const isYesNo = (P: Prepared, taskId: string) => !P.metricsByTask.get(taskId)?.length && !P.partsOf.has(taskId);

const hasTargets = (P: Prepared, habitId: string) =>
	P.ds.variants
		.filter((v) => v.habitId === habitId)
		.some((v) =>
			(P.slotsByVariant.get(v.id) ?? []).some(
				(s) => (s.targets && Object.keys(s.targets).length) || (s.taskId && (P.partsOf.has(s.taskId) || isYesNo(P, s.taskId)))
			)
		);

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** The measures that get a card by themselves on a Task with their fields: per log first, then per week. */
const autoOf = (P: Prepared, t: DsTask): CustomMeasure[] => {
	const own = measuresOf(P).filter((m) => !m.off && (m.auto === 'session' || m.auto === 'week') && fits(m, P.metricsByTask.get(t.id) ?? []));
	return [...own.filter((m) => m.auto === 'session'), ...own.filter((m) => m.auto === 'week')];
};
/** It is logged in rows its measures say all about, so its fields need no cards of their own. */
const inRows = (P: Prepared, t: DsTask) => autoOf(P, t).some((m) => m.sets);
/** The plain numbers these measures read on a Task. */
function readBy(P: Prepared, t: DsTask, ms: CustomMeasure[]): DsMetric[] {
	const names = ms.flatMap((m) => {
		const f = compile(m.formula);
		return f instanceof FormulaError ? [] : fieldsOf(f).map((x) => x.trim().toLowerCase());
	});
	return (P.metricsByTask.get(t.id) ?? []).filter((m) => m.type === 'number' && names.includes(m.name.trim().toLowerCase()));
}
const measureCard = (m: CustomMeasure, t: DsTask, filter: In['filter']) =>
	m.auto === 'week'
		? card({ title: `${t.name}: ${lower(m.name)} per week`, what: { source: 'task', taskId: t.id }, perLog: perLogOf(m), overTime: m.over ?? 'sum', bucket: 'week', range: '90d', filter, look: { chart: 'bars', size: 'wide' } })
		: card({ title: `${t.name}: ${lower(m.name)}`, what: { source: 'task', taskId: t.id }, perLog: perLogOf(m), overTime: m.over ?? 'sum', bucket: 'session', range: '90d', filter, look: { chart: 'line', size: 'wide' } });
/** One card for all the Tasks of a habit: a measure by the members of the first grouping. */
function splitCards(P: Prepared, tasks: DsTask[], filter?: In['filter']): StatCard[] {
	if (!tasks.some((t) => t.tags.length)) return [];
	return measuresOf(P)
		.filter((m) => m.auto === 'split' && !m.off)
		.map((m) =>
			card({
				title: `${m.name} per ${groupsOf(P).groupings[0].one} this week`,
				what: { source: 'task' },
				perLog: perLogOf(m),
				overTime: 'sum',
				bucket: 'all',
				split: 'tag',
				range: 'week',
				...(filter ? { filter } : {}),
				...(m.aim ? { compare: { goal: m.aim[0], goalMax: m.aim[1] } } : {}),
				look: { chart: 'bars', size: 'wide', top: 12 }
			})
		);
}
const isPace = (P: Prepared, t: DsTask) => autoOf(P, t).some((m) => !m.sets);

/** Cards for one Task's fields, scoped by `filter`. */
export function taskCards(P: Prepared, t: DsTask, opts: { habitId?: string } = {}): StatCard[] {
	return stable(`${opts.habitId ?? ''}|${t.id}`, taskCardsOf(P, t, opts));
}

function taskCardsOf(P: Prepared, t: DsTask, opts: { habitId?: string }): StatCard[] {
	const filter = opts.habitId ? { habits: [opts.habitId] } : {};
	const ms = P.metricsByTask.get(t.id) ?? [];
	const out: StatCard[] = [];
	const auto = autoOf(P, t);
	if (inRows(P, t)) {
		out.push(...auto.map((m) => measureCard(m, t, filter)));
		const best = auto[0];
		if (auto.some((m) => m.record)) out.push(card({ title: `${t.name}: records`, what: { source: 'task', taskId: t.id }, perLog: perLogOf(best), overTime: best.over ?? 'sum', range: 'all', filter, look: { chart: 'records', size: 'small' } }));
		out.push(card({ title: `${t.name}: recent sessions`, what: { source: 'task', taskId: t.id }, perLog: 'sets', overTime: 'sum', range: 'all', filter, look: { chart: 'sessions', size: 'wide', top: 5 } }));
		return out;
	}
	for (const over of readBy(P, t, auto))
		out.push(card({ title: `${t.name}: ${over.name.toLowerCase()} per week`, what: { source: 'field', metrics: [over.id] }, perLog: 'value', overTime: 'sum', bucket: 'week', range: '90d', filter, look: { chart: 'bars', size: 'wide' } }));
	out.push(...auto.map((m) => measureCard(m, t, filter)));
	for (const m of ms) {
		// What its measures are made of needs no card of its own.
		if (auto.length && (m.type === 'duration' || m.type === 'number')) continue;
		out.push(...fieldCards(t, m, filter));
	}
	if (ms.some((m) => m.repeats))
		out.push(card({ title: `${t.name}: recent sessions`, what: { source: 'task', taskId: t.id }, perLog: 'sets', range: 'all', filter, look: { chart: 'sessions', size: 'wide', top: 5 } }));
	return out;
}

function fieldCards(t: DsTask, m: DsMetric, filter: { habits?: string[] }): StatCard[] {
	const what = { source: 'field' as const, metrics: [m.id] };
	const name = `${t.name}: ${m.name.toLowerCase()}`;
	switch (m.type) {
		case 'duration':
			return [
				card({ title: `${m.name} this week`, what, perLog: 'value', overTime: 'sum', range: 'week', filter, compare: { previous: true }, look: { chart: 'tile' } }),
				card({ title: `${name} per week`, what, perLog: 'value', overTime: 'sum', bucket: 'week', range: '90d', filter, look: { chart: 'bars', size: 'wide' } })
			];
		case 'count':
			return m.repeats
				? [card({ title: `${name}, best set`, what, perLog: 'best', overTime: 'max', bucket: 'session', range: '90d', filter, look: { chart: 'line', size: 'wide' } })]
				: [
						card({ title: `${m.name} so far`, what, perLog: 'value', overTime: 'sum', range: 'all', filter, compare: { running: true }, look: { chart: 'tile' } }),
						card({ title: `${name} per week`, what, perLog: 'value', overTime: 'sum', bucket: 'week', range: '90d', filter, look: { chart: 'bars', size: 'wide' } })
					];
		case 'number':
			return m.repeats
				? [card({ title: `${name}, best set`, what, perLog: 'best', overTime: 'max', bucket: 'session', range: '90d', filter, look: { chart: 'line', size: 'wide' } })]
				: [
						card({ title: `Latest ${m.name.toLowerCase()}`, what, perLog: 'value', overTime: 'last', range: 'all', filter, look: { chart: 'tile' } }),
						card({ title: `${name}, daily average`, what, perLog: 'value', overTime: 'avg', bucket: 'day', range: '90d', filter, compare: { rolling: 7 }, look: { chart: 'line', size: 'wide' } })
					];
		case 'checkbox':
			return [card({ title: `${name}: ticked`, what, perLog: 'ticked', overTime: 'avg', range: '30d', filter, look: { chart: 'tile' } })];
		case 'choice': {
			const counts = card({ title: name, what, perLog: 'option', overTime: 'count', split: 'option', range: '90d', filter, look: { chart: 'breakdown', size: 'wide' } });
			// J5: a scored choice (mood 5 to 1) also gets its average over time.
			if (!m.scores || !Object.keys(m.scores).length) return [counts];
			return [
				card({ title: `${name}, weekly average`, what, perLog: 'score', overTime: 'avg', bucket: 'week', range: '90d', filter, look: { chart: 'line', size: 'wide' } }),
				counts
			];
		}
		default:
			return [];
	}
}

/** The habit Stats tab, built from the habit's own fields (A1). */
export function habitCards(P: Prepared, h: DsHabit): StatCard[] {
	// Capped like a board, so customizing the tab (which saves this list) never goes over.
	return stable(h.id, habitCardsOf(P, h)).slice(0, MAX_CARDS);
}

function habitCardsOf(P: Prepared, h: DsHabit): StatCard[] {
	const filter = { habits: [h.id] };
	if (h.direction === 'break') {
		const out = [
			card({ title: 'Days clean', what: { source: 'slips' }, perLog: 'count', filter, look: { chart: 'streak', size: 'wide' } }),
			card({ title: 'Slips per week', what: { source: 'slips' }, perLog: 'count', overTime: 'sum', bucket: 'week', range: '90d', filter, look: { chart: 'bars', size: 'wide' } }),
			card({ title: 'Cravings resisted', what: { source: 'cravings' }, perLog: 'count', overTime: 'sum', range: '30d', filter, compare: { previous: true }, look: { chart: 'tile' } }),
			card({ title: 'When slips happen', what: { source: 'slips' }, perLog: 'count', overTime: 'sum', range: '90d', filter, look: { chart: 'pattern', size: 'wide' } })
		];
		if (h.cost?.perDay)
			out.splice(1, 0, card({ title: 'Money saved', what: { source: 'money' }, perLog: 'saved', overTime: 'sum', range: 'all', filter, look: { chart: 'tile' } }));
		return out;
	}
	// A tracker is never done or missed: its tab is what it logged.
	const out = !counts(h) ? [] : [
		card({ title: 'Streak', what: { source: 'outcomes' }, perLog: 'done', filter, look: { chart: 'streak', size: 'wide' } }),
		card({ title: 'Consistency', what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', range: '30d', filter, compare: { previous: true }, look: { chart: 'tile' } }),
		card({ title: 'Done this week', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: 'week', filter, compare: { previous: true }, look: { chart: 'tile' } })
	];
	if (hasTargets(P, h.id))
		out.push(card({ title: 'Target met', what: { source: 'outcomes' }, perLog: 'targetMet', overTime: 'avg', range: '30d', filter, look: { chart: 'tile' } }));
	if (counts(h)) out.push(card({ title: 'Calendar', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: '90d', filter, look: { chart: 'calendar', size: 'full' } }));
	const tasks = habitTasks(P, h.id);
	const rows = tasks.filter((t) => inRows(P, t));
	if (rows.length > 2) {
		// Several of them: a few cards for the whole session instead of four per Task.
		out.push(...splitCards(P, rows, filter));
		const shared = autoOf(P, rows[0]).filter((m) => rows.every((t) => autoOf(P, t).includes(m)));
		for (const m of shared.filter((x) => x.auto === 'week')) out.push(card({ title: `${m.name} per week`, what: { source: 'task' }, perLog: perLogOf(m), overTime: m.over ?? 'sum', bucket: 'week', range: '90d', filter, look: { chart: 'bars', size: 'wide' } }));
		for (const m of shared.filter((x) => x.auto === 'session')) out.push(card({ title: `Best ${lower(m.name)} per Task`, what: { source: 'task' }, perLog: perLogOf(m), overTime: m.over ?? 'max', split: 'task', range: '90d', filter, look: { chart: 'table', size: 'full', top: 20 } }));
		const ranked = [...rows].sort((a, b) => (P.logsByTask.get(b.id)?.length ?? 0) - (P.logsByTask.get(a.id)?.length ?? 0));
		for (const t of ranked.slice(0, 3)) out.push(...autoOf(P, t).filter((m) => m.auto === 'session').map((m) => measureCard(m, t, filter)));
	} else for (const t of rows) out.push(...taskCardsOf(P, t, { habitId: h.id }));
	for (const t of tasks.filter((x) => !inRows(P, x))) out.push(...taskCardsOf(P, t, { habitId: h.id }));
	return out;
}

// ---------- headline numbers on Today ----------

export interface HeadlineOption {
	key: string;
	label: string;
	card: StatCard;
}

/** Single numbers a habit can show on Today, from its own fields (L9). */
export function headlineOptions(P: Prepared, h: DsHabit): HeadlineOption[] {
	const filter = { habits: [h.id] };
	const opt = (key: string, label: string, c: In): HeadlineOption => ({ key, label, card: makeCard({ ...c, id: key, title: label, filter, look: { chart: 'tile' } }) });
	if (h.direction === 'break') {
		const out = [
			opt('slips:week', 'Slips this week', { what: { source: 'slips' }, perLog: 'count', overTime: 'sum', range: 'week' }),
			opt('cravings:week', 'Cravings resisted this week', { what: { source: 'cravings' }, perLog: 'count', overTime: 'sum', range: 'week' })
		];
		if (h.cost?.perDay) out.push(opt('money:all', 'Money saved', { what: { source: 'money' }, perLog: 'saved', overTime: 'sum', range: 'all' }));
		return out;
	}
	const out: HeadlineOption[] = [];
	if (hasTargets(P, h.id)) out.push(opt('target:30d', 'Target met, last 30 days', { what: { source: 'outcomes' }, perLog: 'targetMet', overTime: 'avg', range: '30d' }));
	for (const t of habitTasks(P, h.id)) {
		if (inRows(P, t)) {
			for (const m of autoOf(P, t))
				out.push(
					m.auto === 'session'
						? opt(`${m.id}:${t.id}`, `Best ${lower(m.name)}, ${t.name}`, { what: { source: 'task', taskId: t.id }, perLog: perLogOf(m), overTime: m.over ?? 'max', range: '90d' })
						: opt(`${m.id}:${t.id}`, `${m.name} this week, ${t.name}`, { what: { source: 'task', taskId: t.id }, perLog: perLogOf(m), overTime: m.over ?? 'sum', range: 'week' })
				);
			continue;
		}
		for (const m of P.metricsByTask.get(t.id) ?? []) {
			const what = { source: 'field' as const, metrics: [m.id] };
			if (m.type === 'duration') out.push(opt(`week:${m.id}`, `${m.name} this week`, { what, perLog: 'value', overTime: 'sum', range: 'week' }));
			else if (m.type === 'count' && !m.repeats) {
				out.push(opt(`all:${m.id}`, `${m.name} so far`, { what, perLog: 'value', overTime: 'sum', range: 'all' }));
				out.push(opt(`week:${m.id}`, `${m.name} this week`, { what, perLog: 'value', overTime: 'sum', range: 'week' }));
			} else if (m.type === 'number' && !m.repeats) out.push(opt(`last:${m.id}`, `Latest ${m.name.toLowerCase()}`, { what, perLog: 'value', overTime: 'last', range: 'all' }));
		}
	}
	return out;
}

// ---------- starting points for a board ----------

/** What a board can be made of, from whatever you track. No shape knows what it is about. */
export type BoardShape = 'overview' | 'rows' | 'time' | 'numbers' | 'breaking';
export interface BoardSeed {
	id: string;
	shape: BoardShape;
	name: string;
	blurb: string;
	/** What one day of its habits is called: "Sessions". */
	days?: string;
}
const SEEDS: BoardSeed[] = [
	{ id: 'overview', shape: 'overview', name: 'Overview', blurb: 'Done this week, consistency, streaks, target met and a calendar.' },
	{ id: 'rows', shape: 'rows', name: 'Measures', blurb: 'What you log in rows: days per week, each grouping, your measures and records.' },
	{ id: 'time', shape: 'time', name: 'Time', blurb: 'Time per week, running totals, and which weekdays it happens on.' },
	{ id: 'numbers', shape: 'numbers', name: 'Numbers', blurb: 'Each number as a line with a 7-day average, and how often it was done.' },
	{ id: 'breaking', shape: 'breaking', name: 'Breaking habits', blurb: 'Days clean, money saved, cravings resisted and when slips happen.' }
];
/** Those, with the ones your packs name in their own words in place of the plain one. */
export function boardSeeds(packs: string[]): BoardSeed[] {
	const own = PACKS.filter((p) => packs.includes(p.id)).flatMap((p) => p.boards ?? []);
	return [...SEEDS.filter((x) => !own.some((o) => o.shape === x.shape)), ...own];
}
export const seedById = (id: string): BoardSeed | undefined => [...SEEDS, ...PACKS.flatMap((p) => p.boards ?? [])].find((x) => x.id === id);

/** Which board goes with which view template. */
export const BOARD_FOR_VIEW: Record<string, string | undefined> = { gym: 'rows', quitter: 'breaking' };

const logsPerTask = (P: Prepared) =>
	[...P.logsByTask.entries()].map(([id, ls]) => ({ t: P.tasks.get(id)!, n: ls.length })).filter((x) => x.t).sort((a, b) => b.n - a.n);

export function boardFrom(seed: BoardSeed, P: Prepared): Board {
	const id = seed.shape;
	const b = (cards: StatCard[]): Board => ({
		id: newId(),
		name: seed.name,
		cards,
		range: '30d',
		filter: { areas: [], tags: [], habit: null, identity: null, direction: 'all' },
		template: seed.id
	});
	const build = P.ds.habits.filter((h) => h.direction === 'build' && !h.archived);
	if (id === 'overview') {
		const cards = [
			card({ title: 'Done this week', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: 'week', compare: { previous: true }, look: { chart: 'tile' } }),
			card({ title: 'Consistency', what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', compare: { previous: true }, look: { chart: 'tile' } }),
			card({ title: 'Target met', what: { source: 'outcomes' }, perLog: 'targetMet', overTime: 'avg', look: { chart: 'tile' } }),
			card({ title: 'Consistency per habit', what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', bucket: 'all', split: 'habit', look: { chart: 'bars', size: 'wide', top: 12 } }),
			card({ title: 'Streaks', what: { source: 'outcomes' }, perLog: 'done', look: { chart: 'streak', size: 'wide' } }),
			card({ title: 'Done per day', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: '90d', look: { chart: 'calendar', size: 'full' } })
		];
		if (P.ds.habits.some((h) => h.direction === 'break' && !h.archived))
			cards.splice(3, 0, card({ title: 'Slips this week', what: { source: 'slips' }, perLog: 'count', overTime: 'sum', range: 'week', compare: { previous: true }, look: { chart: 'tile' } }));
		return b(cards);
	}
	if (id === 'rows') {
		const rows = logsPerTask(P).filter((x) => inRows(P, x.t));
		const own = build.filter((h) => habitTasks(P, h.id).some((t) => inRows(P, t))).map((h) => h.id);
		const cards = [
			card({ title: `${seed.days ?? 'Days'} per week`, what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', bucket: 'week', range: '90d', filter: { habits: own }, look: { chart: 'bars', size: 'wide' } }),
			...splitCards(P, rows.map((x) => x.t)),
			...measuresOf(P)
				.filter((m) => m.auto === 'week' && m.sets && !m.off)
				.map((m) => card({ title: `${m.name} per week`, what: { source: 'task' }, perLog: perLogOf(m), overTime: m.over ?? 'sum', bucket: 'week', range: '90d', look: { chart: 'bars', size: 'wide' } }))
		];
		const best = (t: DsTask) => autoOf(P, t).filter((m) => m.auto === 'session');
		for (const x of rows.slice(0, 3)) cards.push(...best(x.t).map((m) => measureCard(m, x.t, undefined)));
		const top = rows[0] && best(rows[0].t)[0];
		if (top) cards.push(card({ title: `${rows[0].t.name}: records`, what: { source: 'task', taskId: rows[0].t.id }, perLog: perLogOf(top), overTime: top.over ?? 'sum', range: 'all', look: { chart: 'records' } }));
		return b(cards);
	}
	if (id === 'time') {
		const durations = new Map<string, number>();
		const counts = new Map<string, number>();
		for (const m of P.ds.metrics) {
			const n = (P.logsByTask.get(m.taskId) ?? []).length + 1;
			if (m.type === 'duration') durations.set(m.name, (durations.get(m.name) ?? 0) + n);
			if (m.type === 'count' && !m.repeats) counts.set(m.name, (counts.get(m.name) ?? 0) + n);
		}
		const top = [...durations.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? 'Minutes';
		const cards = [
			card({ title: `${top} this week`, what: { source: 'field', name: top }, perLog: 'value', overTime: 'sum', range: 'week', compare: { previous: true }, look: { chart: 'tile' } }),
			card({ title: `${top} per week`, what: { source: 'field', name: top }, perLog: 'value', overTime: 'sum', bucket: 'week', split: 'task', range: '90d', look: { chart: 'bars', size: 'wide', stacked: true } })
		];
		for (const [name] of [...counts.entries()].sort((a, c) => c[1] - a[1]).slice(0, 3))
			cards.push(card({ title: `${name} so far`, what: { source: 'field', name }, perLog: 'value', overTime: 'sum', range: 'all', compare: { running: true }, look: { chart: 'tile' } }));
		cards.push(
			card({ title: `${top} by weekday`, what: { source: 'field', name: top }, perLog: 'value', overTime: 'sum', bucket: 'all', split: 'weekday', range: '90d', look: { chart: 'bars', size: 'wide' } }),
			card({ title: `${top} per day`, what: { source: 'field', name: top }, perLog: 'value', overTime: 'sum', range: '90d', look: { chart: 'calendar', size: 'full' } })
		);
		return b(cards);
	}
	if (id === 'breaking') {
		const cards = [
			card({ title: 'Days clean', what: { source: 'slips' }, perLog: 'count', look: { chart: 'streak', size: 'wide' } }),
			card({ title: 'Money saved', what: { source: 'money' }, perLog: 'saved', overTime: 'sum', range: 'all', look: { chart: 'tile' } }),
			card({ title: 'Cravings resisted', what: { source: 'cravings' }, perLog: 'count', overTime: 'sum', compare: { previous: true }, look: { chart: 'tile' } }),
			card({ title: 'Slips per week', what: { source: 'slips' }, perLog: 'count', overTime: 'sum', bucket: 'week', split: 'habit', range: '90d', look: { chart: 'bars', size: 'wide', stacked: true } }),
			card({ title: 'When slips happen', what: { source: 'slips' }, perLog: 'count', overTime: 'sum', range: '90d', look: { chart: 'pattern', size: 'wide' } })
		];
		const board = b(cards);
		board.filter.direction = 'break';
		return board;
	}
	// numbers
	const vitals = P.ds.metrics
		.filter((m) => m.type === 'number' && !m.repeats && !(P.tasks.get(m.taskId) && isPace(P, P.tasks.get(m.taskId)!)))
		.map((m) => ({ m, n: (P.logsByTask.get(m.taskId) ?? []).length }))
		.sort((a, c) => c.n - a.n)
		.slice(0, 6);
	const cards = [
		card({ title: 'Done as planned', what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', compare: { previous: true }, look: { chart: 'tile' } }),
		card({ title: 'Done per habit', what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', bucket: 'all', split: 'habit', look: { chart: 'bars', size: 'wide', top: 12 } })
	];
	for (const { m } of vitals)
		cards.push(card({ title: m.name, what: { source: 'field', metrics: [m.id] }, perLog: 'value', overTime: 'avg', bucket: 'day', range: '90d', compare: { rolling: 7 }, look: { chart: 'line', size: 'wide' } }));
	return b(cards);
}

/** Starting boards: Overview, plus the one that matches the view template (choice 3). */
export function startingBoards(P: Prepared, viewTemplate: string): Board[] {
	const out = [boardFrom(seedById('overview')!, P)];
	const extra = seedById(BOARD_FOR_VIEW[viewTemplate] ?? '');
	if (extra) out.push(boardFrom(extra, P));
	return out;
}

/** Cards offered under "Suggested" when adding a card to a board: every habit's auto cards, without duplicates. */
export function suggestedCards(P: Prepared): { group: string; habitId: string; cards: StatCard[] }[] {
	const out: { group: string; habitId: string; cards: StatCard[] }[] = [];
	for (const h of P.ds.habits.filter((x) => !x.archived)) {
		const cards = habitCards(P, h).filter((c) => c.look.chart !== 'calendar' || h.direction === 'build');
		if (cards.length) out.push({ group: h.name, habitId: h.id, cards: cards.map((c) => ({ ...c, title: c.title.includes(h.name) ? c.title : `${h.name}: ${c.title.charAt(0).toLowerCase()}${c.title.slice(1)}` })) });
	}
	return out;
}

/** Cards of your own measures. */
function measureGroup(P: Prepared): { group: string; cards: StatCard[] }[] {
	const ms = measuresOf(P).filter((m) => !m.off && m.auto);
	const cards = ms.flatMap((m) =>
		m.auto === 'split'
			? [card({ title: `${m.name} per ${groupsOf(P).groupings[0].one}`, what: { source: 'task' }, perLog: perLogOf(m), overTime: 'sum', bucket: 'all', split: 'tag', range: 'week', ...(m.aim ? { compare: { goal: m.aim[0], goalMax: m.aim[1] } } : {}), look: { chart: 'bars', size: 'wide', top: 12 } })]
			: m.auto === 'week'
				? [
						card({ title: `Weekly ${lower(m.name)}`, what: { source: 'task' }, perLog: perLogOf(m), overTime: m.over ?? 'sum', bucket: 'week', range: '90d', look: { chart: 'bars', size: 'wide' } }),
						card({ title: `${m.name} per Task`, what: { source: 'task' }, perLog: perLogOf(m), overTime: m.over ?? 'sum', split: 'task', look: { chart: 'table', size: 'wide' } })
					]
				: []
	);
	return cards.length ? [{ group: 'Your measures', cards }] : [];
}

/** Named presets for the card gallery: common questions that need no setup. */
export function galleryCards(P: Prepared): { group: string; cards: StatCard[] }[] {
	return [
		{
			group: 'Habits',
			cards: [
				card({ title: 'Done this week', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: 'week', compare: { previous: true }, look: { chart: 'tile' } }),
				card({ title: 'Consistency', what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', compare: { previous: true }, look: { chart: 'tile' } }),
				card({ title: 'Target met', what: { source: 'outcomes' }, perLog: 'targetMet', overTime: 'avg', look: { chart: 'tile' } }),
				card({ title: 'Done per week', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', bucket: 'week', split: 'habit', range: '90d', look: { chart: 'bars', size: 'wide', stacked: true } }),
				card({ title: 'Consistency per habit', what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', bucket: 'all', split: 'habit', look: { chart: 'bars', size: 'wide', top: 12 } }),
				card({ title: 'Streaks', what: { source: 'outcomes' }, perLog: 'done', look: { chart: 'streak', size: 'wide' } }),
				card({ title: 'Done per day', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: '90d', look: { chart: 'calendar', size: 'full' } }),
				card({ title: 'Levels reached', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', split: 'level', look: { chart: 'breakdown', size: 'wide' } }),
				card({ title: 'When habits get done', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: '90d', look: { chart: 'pattern', size: 'wide' } })
			]
		},
		...measureGroup(P),
		{
			group: 'Breaking habits',
			cards: [
				card({ title: 'Days clean', what: { source: 'slips' }, perLog: 'count', look: { chart: 'streak', size: 'wide' } }),
				card({ title: 'Money saved', what: { source: 'money' }, perLog: 'saved', overTime: 'sum', range: 'all', look: { chart: 'tile' } }),
				card({ title: 'Cravings resisted', what: { source: 'cravings' }, perLog: 'count', overTime: 'sum', compare: { previous: true }, look: { chart: 'tile' } }),
				card({ title: 'Slips per week', what: { source: 'slips' }, perLog: 'count', overTime: 'sum', bucket: 'week', range: '90d', look: { chart: 'bars', size: 'wide' } }),
				card({ title: 'When slips happen', what: { source: 'slips' }, perLog: 'count', overTime: 'sum', range: '90d', look: { chart: 'pattern', size: 'wide' } })
			]
		}
	];
}
