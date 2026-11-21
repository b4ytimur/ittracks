// Cards nobody has to build (A1) and whole boards in one tap (A2).
// Auto cards come from the type of each field a habit or Task logs; board templates pick
// the habits and Tasks that fit them from what the account already has.
import { makeCard, MAX_CARDS, newId, type Board, type StatCard, type StatCardInput } from './model';
import type { DsHabit, DsMetric, DsTask, Prepared } from './engine';

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

const hasTargets = (P: Prepared, habitId: string) =>
	P.ds.variants
		.filter((v) => v.habitId === habitId)
		.some((v) => (P.slotsByVariant.get(v.id) ?? []).some((s) => (s.targets && Object.keys(s.targets).length) || (s.taskId && P.ds.tasks.some((t) => t.parentTaskId === s.taskId))));

const isStrength = (P: Prepared, t: DsTask) => {
	const r = P.roles.get(t.id);
	return !!r?.weight && !!r.reps;
};
const isCardio = (P: Prepared, t: DsTask) => {
	const r = P.roles.get(t.id);
	return !!r?.distance && !!r.time;
};

/** Cards for one Task's fields, scoped by `filter`. */
export function taskCards(P: Prepared, t: DsTask, opts: { habitId?: string } = {}): StatCard[] {
	return stable(`${opts.habitId ?? ''}|${t.id}`, taskCardsOf(P, t, opts));
}

function taskCardsOf(P: Prepared, t: DsTask, opts: { habitId?: string }): StatCard[] {
	const filter = opts.habitId ? { habits: [opts.habitId] } : {};
	const ms = P.metricsByTask.get(t.id) ?? [];
	const out: StatCard[] = [];
	if (isStrength(P, t)) {
		out.push(
			card({ title: `${t.name}: estimated 1RM`, what: { source: 'task', taskId: t.id }, perLog: 'e1rm', overTime: 'max', bucket: 'session', range: '90d', filter, look: { chart: 'line', size: 'wide' } }),
			card({ title: `${t.name}: volume per week`, what: { source: 'task', taskId: t.id }, perLog: 'volume', overTime: 'sum', bucket: 'week', range: '90d', filter, look: { chart: 'bars', size: 'wide' } }),
			card({ title: `${t.name}: records`, what: { source: 'task', taskId: t.id }, perLog: 'e1rm', overTime: 'max', range: 'all', filter, look: { chart: 'records', size: 'small' } }),
			card({ title: `${t.name}: recent sessions`, what: { source: 'task', taskId: t.id }, perLog: 'sets', overTime: 'sum', range: 'all', filter, look: { chart: 'sessions', size: 'wide', top: 5 } })
		);
		return out;
	}
	if (isCardio(P, t)) {
		const r = P.roles.get(t.id)!;
		out.push(
			card({ title: `${t.name}: ${r.distance!.name.toLowerCase()} per week`, what: { source: 'field', metrics: [r.distance!.id] }, perLog: 'value', overTime: 'sum', bucket: 'week', range: '90d', filter, look: { chart: 'bars', size: 'wide' } }),
			card({ title: `${t.name}: pace`, what: { source: 'task', taskId: t.id }, perLog: 'pace', overTime: 'avg', bucket: 'session', range: '90d', filter, look: { chart: 'line', size: 'wide' } })
		);
	}
	for (const m of ms) {
		if (isCardio(P, t) && (m.type === 'duration' || m.type === 'number')) continue;
		out.push(...fieldCards(t, m, filter));
	}
	if (ms.some((m) => m.repeats) && !isStrength(P, t))
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
		case 'choice':
			return [card({ title: name, what, perLog: 'option', overTime: 'count', split: 'option', range: '90d', filter, look: { chart: 'breakdown', size: 'wide' } })];
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
	const out = [
		card({ title: 'Streak', what: { source: 'outcomes' }, perLog: 'done', filter, look: { chart: 'streak', size: 'wide' } }),
		card({ title: 'Consistency', what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', range: '30d', filter, compare: { previous: true }, look: { chart: 'tile' } }),
		card({ title: 'Done this week', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: 'week', filter, compare: { previous: true }, look: { chart: 'tile' } })
	];
	if (hasTargets(P, h.id))
		out.push(card({ title: 'Target met', what: { source: 'outcomes' }, perLog: 'targetMet', overTime: 'avg', range: '30d', filter, look: { chart: 'tile' } }));
	out.push(card({ title: 'Calendar', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', range: '90d', filter, look: { chart: 'calendar', size: 'full' } }));
	const tasks = habitTasks(P, h.id);
	const lifts = tasks.filter((t) => isStrength(P, t));
	if (lifts.length > 2) {
		// A full workout: a few cards for the whole session instead of four per exercise.
		if (lifts.some((t) => t.tags.length))
			out.push(card({ title: 'Hard sets per muscle group this week', what: { source: 'task' }, perLog: 'hardSets', overTime: 'sum', bucket: 'all', split: 'tag', range: 'week', filter, compare: { goal: 10, goalMax: 20 }, look: { chart: 'bars', size: 'wide', top: 12 } }));
		out.push(
			card({ title: 'Volume per week', what: { source: 'task' }, perLog: 'volume', overTime: 'sum', bucket: 'week', range: '90d', filter, look: { chart: 'bars', size: 'wide' } }),
			card({ title: 'Best estimated 1RM per exercise', what: { source: 'task' }, perLog: 'e1rm', overTime: 'max', split: 'task', range: '90d', filter, look: { chart: 'table', size: 'full', top: 20 } })
		);
		const ranked = [...lifts].sort((a, b) => (P.logsByTask.get(b.id)?.length ?? 0) - (P.logsByTask.get(a.id)?.length ?? 0));
		for (const t of ranked.slice(0, 3))
			out.push(card({ title: `${t.name}: estimated 1RM`, what: { source: 'task', taskId: t.id }, perLog: 'e1rm', overTime: 'max', bucket: 'session', range: '90d', filter, look: { chart: 'line', size: 'wide' } }));
	} else for (const t of lifts) out.push(...taskCardsOf(P, t, { habitId: h.id }));
	for (const t of tasks.filter((x) => !isStrength(P, x))) out.push(...taskCardsOf(P, t, { habitId: h.id }));
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
		if (isStrength(P, t)) {
			out.push(opt(`e1rm:${t.id}`, `Best e1RM, ${t.name}`, { what: { source: 'task', taskId: t.id }, perLog: 'e1rm', overTime: 'max', range: '90d' }));
			out.push(opt(`volume:${t.id}`, `Volume this week, ${t.name}`, { what: { source: 'task', taskId: t.id }, perLog: 'volume', overTime: 'sum', range: 'week' }));
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

// ---------- board templates (A2) ----------

export const BOARD_TEMPLATES = {
	overview: { name: 'Overview', blurb: 'Everyone: done this week, consistency, streaks, target met and a calendar.' },
	gym: { name: 'Gym', blurb: 'Lifters: sessions per week, hard sets per muscle group, volume, e1RM and records.' },
	learner: { name: 'Learner', blurb: 'Languages and study: minutes per week, running totals and minutes by weekday.' },
	quitter: { name: 'Quitter', blurb: 'Breaking habits: days clean, money saved, cravings resisted and when slips happen.' },
	health: { name: 'Health log', blurb: 'Meds and vitals: each number as a line with a 7-day average, doses taken.' }
} as const;
export type BoardTemplateId = keyof typeof BOARD_TEMPLATES;

/** Which board template goes with which view template. */
export const BOARD_FOR_VIEW: Record<string, BoardTemplateId | undefined> = { gym: 'gym', quitter: 'quitter', data: undefined };

const logsPerTask = (P: Prepared) =>
	[...P.logsByTask.entries()].map(([id, ls]) => ({ t: P.tasks.get(id)!, n: ls.length })).filter((x) => x.t).sort((a, b) => b.n - a.n);

export function boardTemplate(id: BoardTemplateId, P: Prepared): Board {
	const b = (cards: StatCard[]): Board => ({
		id: newId(),
		name: BOARD_TEMPLATES[id].name,
		cards,
		range: '30d',
		filter: { areas: [], tags: [], habit: null, identity: null, direction: 'all' },
		template: id
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
	if (id === 'gym') {
		const lifts = logsPerTask(P).filter((x) => isStrength(P, x.t));
		const gymHabits = build.filter((h) => habitTasks(P, h.id).some((t) => isStrength(P, t))).map((h) => h.id);
		const cards = [
			card({ title: 'Sessions per week', what: { source: 'outcomes' }, perLog: 'done', overTime: 'sum', bucket: 'week', range: '90d', filter: { habits: gymHabits }, look: { chart: 'bars', size: 'wide' } }),
			card({ title: 'Hard sets per muscle group this week', what: { source: 'task' }, perLog: 'hardSets', overTime: 'sum', bucket: 'all', split: 'tag', range: 'week', compare: { goal: 10, goalMax: 20 }, look: { chart: 'bars', size: 'wide', top: 12 } }),
			card({ title: 'Volume per week', what: { source: 'task' }, perLog: 'volume', overTime: 'sum', bucket: 'week', range: '90d', look: { chart: 'bars', size: 'wide' } })
		];
		for (const x of lifts.slice(0, 3))
			cards.push(card({ title: `${x.t.name}: estimated 1RM`, what: { source: 'task', taskId: x.t.id }, perLog: 'e1rm', overTime: 'max', bucket: 'session', range: '90d', look: { chart: 'line', size: 'wide' } }));
		if (lifts[0]) cards.push(card({ title: `${lifts[0].t.name}: records`, what: { source: 'task', taskId: lifts[0].t.id }, perLog: 'e1rm', overTime: 'max', range: 'all', look: { chart: 'records' } }));
		return b(cards);
	}
	if (id === 'learner') {
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
	if (id === 'quitter') {
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
	// health
	const vitals = P.ds.metrics
		.filter((m) => m.type === 'number' && !m.repeats && !P.roles.get(m.taskId)?.distance)
		.map((m) => ({ m, n: (P.logsByTask.get(m.taskId) ?? []).length }))
		.sort((a, c) => c.n - a.n)
		.slice(0, 6);
	const cards = [
		card({ title: 'Taken as planned', what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', compare: { previous: true }, look: { chart: 'tile' } }),
		card({ title: 'Taken per habit', what: { source: 'outcomes' }, perLog: 'rate', overTime: 'avg', bucket: 'all', split: 'habit', look: { chart: 'bars', size: 'wide', top: 12 } })
	];
	for (const { m } of vitals)
		cards.push(card({ title: m.name, what: { source: 'field', metrics: [m.id] }, perLog: 'value', overTime: 'avg', bucket: 'day', range: '90d', compare: { rolling: 7 }, look: { chart: 'line', size: 'wide' } }));
	return b(cards);
}

/** Starting boards: Overview, plus the one that matches the view template (choice 3). */
export function startingBoards(P: Prepared, viewTemplate: string): Board[] {
	const out = [boardTemplate('overview', P)];
	const extra = BOARD_FOR_VIEW[viewTemplate];
	if (extra) out.push(boardTemplate(extra, P));
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

/** Named presets for the card gallery: common questions that need no setup. */
export function galleryCards(): { group: string; cards: StatCard[] }[] {
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
		{
			group: 'Gym',
			cards: [
				card({ title: 'Hard sets per muscle group', what: { source: 'task' }, perLog: 'hardSets', overTime: 'sum', bucket: 'all', split: 'tag', range: 'week', compare: { goal: 10, goalMax: 20 }, look: { chart: 'bars', size: 'wide', top: 12 } }),
				card({ title: 'Weekly volume', what: { source: 'task' }, perLog: 'volume', overTime: 'sum', bucket: 'week', range: '90d', look: { chart: 'bars', size: 'wide' } }),
				card({ title: 'Volume per exercise', what: { source: 'task' }, perLog: 'volume', overTime: 'sum', split: 'task', look: { chart: 'table', size: 'wide' } })
			]
		},
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
