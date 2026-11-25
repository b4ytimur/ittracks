// Everything an account logged, in the shape the stats engine reads, plus the stored boards.
// One read per table: the engine does the rest in memory, so a card never needs its own query.
import { and, asc, eq, inArray, lte, ne } from 'drizzle-orm';
import { db } from './db';
import { area, craving, entry, habit, habitIdentity, identity, metric, occurrence, slip, slot, tag, task, taskPart, taskTag, variant } from './db/schema';
import { getGroups, getSettings, getUnits, getViews, saveSettings } from './settings';
import { settleAll, timeIn, userToday } from './today';
import { listAreas } from './repo/areas';
import { listIdentities } from './repo/identities';
import { computeCard, describeLog, prepare, singleRows, type CardResult, type Ctx, type Dataset, type DsPart, type Prepared } from '$lib/stats/engine';
import { readStats, statsSettings, type Board, type StatCard, type StatsSettings } from '$lib/stats/model';
import { startingBoards } from '$lib/stats/auto';
import { withSeeds, type SeedField } from '$lib/stats/seed';
import { statCtx, type Catalog } from '$lib/stats/catalog';
import { catalogOf } from '$lib/stats/catalog-of';
import { checkCard } from '$lib/rules/stats';
import { DEFAULT_STREAK_RULE } from '$lib/engine/streak';
import { inReadingOrder } from '$lib/rowtext';
import { logicalDate } from '$lib/engine/day';
import { value as formatValue } from '$lib/stats/format';
import { isGroup, type Schedule } from '$lib/engine/schedule';

export function loadDataset(accountId: string, tz?: string): Dataset {
	const s = getSettings(accountId);
	const zone = tz || s.timeZone;
	const today = userToday(accountId, tz);
	const units = getUnits(accountId);

	const habits = db.select().from(habit).where(eq(habit.accountId, accountId)).all();
	const habitIds = habits.map((h) => h.id);
	const ids = db
		.select({ habitId: habitIdentity.habitId, identityId: habitIdentity.identityId })
		.from(habitIdentity)
		.innerJoin(identity, eq(habitIdentity.identityId, identity.id))
		.where(eq(identity.accountId, accountId))
		.all();
	const tasks = db.select().from(task).where(eq(task.accountId, accountId)).orderBy(asc(task.sortOrder)).all();
	const taskIds = tasks.map((t) => t.id);
	const tags = taskIds.length
		? db
				.select({ taskId: taskTag.taskId, name: tag.name, level: taskTag.level })
				.from(taskTag)
				.innerJoin(tag, eq(taskTag.tagId, tag.id))
				.where(inArray(taskTag.taskId, taskIds))
				.all()
		: [];
	const metrics = taskIds.length ? db.select().from(metric).where(inArray(metric.taskId, taskIds)).orderBy(asc(metric.sortOrder)).all() : [];
	const variants = habitIds.length ? db.select().from(variant).where(inArray(variant.habitId, habitIds)).orderBy(asc(variant.sortOrder)).all() : [];
	const slots = variants.length
		? db
				.select()
				.from(slot)
				.where(inArray(slot.variantId, variants.map((v) => v.id)))
				.orderBy(asc(slot.sortOrder))
				.all()
		: [];
	const occs = habitIds.length ? db.select().from(occurrence).where(inArray(occurrence.habitId, habitIds)).all() : [];
	// Values of every log count, finished or not: a day left at 5 of 6 glasses still drank 5.
	const done = occs.filter((o) => o.status !== 'skipped').map((o) => o.id);
	// Large accounts: read entries in chunks so the IN list stays within SQLite's limit.
	const entries: (typeof entry.$inferSelect)[] = [];
	for (let i = 0; i < done.length; i += 900)
		entries.push(...db.select().from(entry).where(inArray(entry.occurrenceId, done.slice(i, i + 900))).all());
	const slips = habitIds.length ? db.select().from(slip).where(inArray(slip.habitId, habitIds)).all() : [];
	const cravings = habitIds.length ? db.select().from(craving).where(inArray(craving.habitId, habitIds)).all() : [];
	const areas = db.select({ id: area.id, name: area.name }).from(area).where(eq(area.accountId, accountId)).all();

	return {
		today,
		weightUnit: units.shown('weight'),
		units,
		groups: getGroups(accountId),
		measures: getStats(accountId).measures,
		ranges: s.ranges ?? [],
		areas,
		habits: habits.map((h) => ({
			id: h.id,
			name: h.name,
			direction: h.direction,
			areaId: h.areaId,
			startDate: h.startDate,
			archived: h.archived,
			identities: ids.filter((x) => x.habitId === h.id).map((x) => x.identityId),
			cost: h.cost ?? null,
			streakRule: h.streakRule ?? DEFAULT_STREAK_RULE,
			minimumCounts: h.minimumCounts,
			limit: h.limit ?? null,
			...(isGroup(h.schedule as Schedule | null) ? { group: true } : {})
		})),
		tasks: tasks.map((t) => ({
			id: t.id,
			name: t.name,
			areaId: t.areaId,
			parentTaskId: t.parentTaskId,
			archived: t.archived,
			tags: tags.filter((x) => x.taskId === t.id).map((x) => ({ name: x.name, level: x.level }))
		})),
		metrics: metrics.map((m) => ({ id: m.id, taskId: m.taskId, name: m.name, type: m.type, unit: m.unit, repeats: m.repeats, times: m.times, better: m.better, choices: m.choices ?? null, scores: m.scores ?? null, earlierScores: m.earlierScores ?? null })),
		variants: variants.map((v) => ({ id: v.id, habitId: v.habitId, name: v.name })),
		slots: slots.map((x) => ({ id: x.id, variantId: x.variantId, taskId: x.taskId, sets: x.sets, targets: x.targets ?? null, minTargets: x.minTargets ?? null, stretchTargets: x.stretchTargets ?? null })),
		occurrences: occs.map((o) => ({
			id: o.id,
			habitId: o.habitId,
			variantId: o.variantId,
			date: o.date,
			status: o.status,
			level: o.level ?? null,
			picks: o.picks ?? null,
			goals: o.goals ?? null,
			...(o.rollup ? { rollup: o.rollup } : {}),
			// Logged for another day (past-day logging): the finish time says nothing about when it happened.
			time: o.finishedAt && timeIn(zone, o.finishedAt) && sameDay(o.finishedAt, o.date, zone, s.dayStart) ? timeIn(zone, o.finishedAt) : null
		})),
		entries: entries.map((e) => ({ occurrenceId: e.occurrenceId, taskId: e.taskId, values: e.values ?? {}, sortOrder: e.sortOrder, path: e.path })),
		slips: slips.map((x) => ({ habitId: x.habitId, date: x.date, count: x.count, time: x.time })),
		cravings: cravings.map((x) => ({ habitId: x.habitId, date: x.date, time: x.time })),
		parts: partsOfTasks(tasks.map((t) => t.id))
	};
}

/** The parts inside these Tasks, for the stats engine. */
function partsOfTasks(taskIds: string[]): DsPart[] {
	const out: DsPart[] = [];
	for (let i = 0; i < taskIds.length; i += 900)
		out.push(
			...db
				.select({
					id: taskPart.id,
					taskId: taskPart.taskId,
					childTaskId: taskPart.childTaskId,
					sets: taskPart.sets,
					targets: taskPart.targets,
					minTargets: taskPart.minTargets,
					stretchTargets: taskPart.stretchTargets,
					archived: taskPart.archived
				})
				.from(taskPart)
				.where(inArray(taskPart.taskId, taskIds.slice(i, i + 900)))
				.all()
		);
	return out;
}

/** Did `at` fall on `date` in the user's zone, counting the day from `dayStart` as Today does? */
function sameDay(at: Date, date: string, zone: string | undefined, dayStart = '00:00'): boolean {
	let d: string;
	try {
		d = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(at);
	} catch {
		d = at.toISOString().slice(0, 10);
	}
	// A log at 01:00 for a day that starts at 04:00 belongs to the day before.
	return logicalDate(d, timeIn(zone, at), dayStart) === date;
}

/** The account's fields, for the measures it starts from. */
export const seedFields = (accountId: string): SeedField[] =>
	db
		.select({ taskId: metric.taskId, name: metric.name, type: metric.type, unit: metric.unit, repeats: metric.repeats })
		.from(metric)
		.innerJoin(task, eq(metric.taskId, task.id))
		.where(eq(task.accountId, accountId))
		.orderBy(asc(metric.sortOrder))
		.all();

/** Stats as stored. Before measures were data, the ones that were written in code come first. */
export function getStats(accountId: string): StatsSettings {
	const s = readStats(getSettings(accountId).stats);
	if (s.seeded) return s;
	const fields = seedFields(accountId);
	return { ...s, seeded: true, measures: withSeeds(s.measures, fields, s) };
}

export function saveStats(accountId: string, stats: StatsSettings) {
	saveSettings(accountId, { stats: statsSettings.parse(stats) });
}

/** Stored boards, creating the starting ones the first time Stats opens. */
export function boardsOf(accountId: string, P: Prepared): StatsSettings {
	const s = getStats(accountId);
	if (s.boards.length) return s;
	const raw = getSettings(accountId).stats as { boards?: unknown[] } | undefined;
	// Only seed once: someone who deleted every board gets an empty page, not the starters back.
	if (raw && Array.isArray(raw.boards)) return s;
	const boards: Board[] = startingBoards(P, getViews(accountId).template);
	const next = { ...s, boards, offered: [...new Set([...s.offered, ...boards.map((b) => b.template ?? '')])].filter(Boolean) };
	saveStats(accountId, next);
	return next;
}

export function ctxFor(today: string, s: StatsSettings, board?: Pick<Board, 'range' | 'filter'>): Ctx {
	return {
		today,
		boardRange: board?.range ?? '30d',
		boardFilter: board?.filter ?? { areas: [], tags: [], habit: null, identity: null, direction: 'all' },
		settings: { muscle: s.muscle, measures: s.measures }
	};
}

export function catalogFor(accountId: string, P: Prepared): Catalog {
	return catalogOf(P, {
		areas: listAreas(accountId),
		identities: listIdentities(accountId).map((i) => ({ id: i.id, name: i.statement }))
	});
}

/** Everything for one request: the logs, prepared once. */
export function statsContext(accountId: string, tz?: string) {
	// Due days nobody logged count as misses in Stats too, even before Today is opened.
	settleAll(accountId, userToday(accountId, tz));
	const ds = loadDataset(accountId, tz);
	const P = prepare(ds);
	return { ds, P, today: ds.today };
}

export interface StatItem {
	card: StatCard;
	result: CardResult | null;
	warnings: string[];
	rangeKey: string;
}

/** Work out a list of cards for a page, with the warnings the stats rules give for each. */
export function itemsFor(
	cards: StatCard[],
	P: Prepared,
	opts: { catalog: Catalog; stats: StatsSettings; hidden: string[]; today: string; board?: Pick<Board, 'range' | 'filter'> }
): StatItem[] {
	const ctx = ctxFor(opts.today, opts.stats, opts.board);
	return cards.map((card) => {
		const issues = checkCard(card, statCtx(card, opts.catalog, { hidden: opts.hidden, measures: opts.stats.measures }));
		let result: CardResult | null = null;
		try {
			result = computeCard(card, P, ctx);
		} catch (e) {
			console.error('stats card failed', card.id, e);
		}
		return { card, result, warnings: issues.map((i) => i.reason), rangeKey: card.range === 'page' ? ctx.boardRange : card.range };
	});
}

/** Today's headline numbers from habit Stats tabs ("Show on Today"), as text per habit. */
export function headlineTexts(accountId: string, tz?: string): Record<string, string> {
	const s = getStats(accountId);
	// Skip the full read when no picked habit is still there (a headline left from a deleted habit).
	const live = new Set(db.select({ id: habit.id }).from(habit).where(eq(habit.accountId, accountId)).all().map((h) => h.id));
	const entries = Object.entries(s.headlines).filter(([habitId]) => live.has(habitId));
	if (!entries.length) return {};
	const { P, today } = statsContext(accountId, tz);
	const ctx = ctxFor(today, s);
	const out: Record<string, string> = {};
	for (const [habitId, card] of entries) {
		if (!P.habits.has(habitId)) continue;
		try {
			const r = computeCard(card, P, ctx);
			out[habitId] = `${card.title}: ${formatValue(r.total, r.unit, r.kind)}`;
		} catch (e) {
			console.error('headline card failed', habitId, e);
		}
	}
	return out;
}

export interface Recap {
	date: string;
	text: string;
	best: string | null;
}

/**
 * "Last time" and "best" for the Tasks on the log screen (R3): reads only those Tasks' logs,
 * so opening a log stays quick on a big account. Only logs up to `today` count, so a past
 * day's log shows what came before it.
 */
export function recapFor(accountId: string, taskIds: string[], excludeOcc: string, weightUnit: string, today: string): Record<string, Recap> {
	if (!taskIds.length) return {};
	// Those Tasks and everything inside them, so "3 of 4 steps" counts.
	const parts = partsOfTasks(taskIds);
	const inside = new Set(parts.map((p) => p.childTaskId));
	const tasks = db
		.select()
		.from(task)
		.where(eq(task.accountId, accountId))
		.all()
		.filter((t) => taskIds.includes(t.id) || inside.has(t.id) || (t.parentTaskId && taskIds.includes(t.parentTaskId)));
	const ids = tasks.map((t) => t.id);
	if (!ids.length) return {};
	const metrics = db.select().from(metric).where(inArray(metric.taskId, ids)).all();
	const rows = db
		.select({ e: entry, o: occurrence })
		.from(entry)
		.innerJoin(occurrence, eq(entry.occurrenceId, occurrence.id))
		.where(and(inArray(entry.taskId, ids), eq(occurrence.status, 'done'), ne(occurrence.id, excludeOcc), lte(occurrence.date, today)))
		.all();
	const occs = [...new Map(rows.map((r) => [r.o.id, r.o])).values()];
	const habitIds = [...new Set(occs.map((o) => o.habitId))];
	const habits = habitIds.length ? db.select().from(habit).where(and(eq(habit.accountId, accountId), inArray(habit.id, habitIds))).all() : [];
	const ds: Dataset = {
		today,
		weightUnit,
		ranges: [],
		areas: [],
		habits: habits.map((h) => ({ id: h.id, name: h.name, direction: h.direction, areaId: h.areaId, startDate: h.startDate, archived: h.archived, identities: [], cost: null, streakRule: DEFAULT_STREAK_RULE, minimumCounts: true, limit: null })),
		tasks: tasks.map((t) => ({ id: t.id, name: t.name, areaId: t.areaId, parentTaskId: t.parentTaskId, archived: t.archived, tags: [] })),
		metrics: metrics.map((m) => ({ id: m.id, taskId: m.taskId, name: m.name, type: m.type, unit: m.unit, repeats: m.repeats, times: m.times, better: m.better, choices: m.choices ?? null, scores: m.scores ?? null, earlierScores: m.earlierScores ?? null })),
		variants: [],
		slots: [],
		occurrences: occs.map((o) => ({ id: o.id, habitId: o.habitId, variantId: null, date: o.date, status: o.status, level: o.level ?? null, picks: null, time: null })),
		entries: rows.map((r) => ({ occurrenceId: r.e.occurrenceId, taskId: r.e.taskId, values: r.e.values ?? {}, sortOrder: r.e.sortOrder, path: r.e.path })),
		parts,
		slips: [],
		cravings: []
	};
	const P = prepare(ds);
	const out: Record<string, Recap> = {};
	for (const id of taskIds) {
		const logs = P.logsByTask.get(id) ?? [];
		const last = logs.at(-1);
		if (!last) continue;
		out[id] = { date: last.occ.date, text: describeLog(last, P), best: bestOf(P, id) };
	}
	return out;
}

/** The best a Task has done: the top of what a row counts with a ×, else the top value of its first number field. */
function bestOf(P: Prepared, taskId: string): string | null {
	const logs = P.logsByTask.get(taskId) ?? [];
	const rep = inReadingOrder((P.metricsByTask.get(taskId) ?? []).filter((x) => x.repeats && ['number', 'duration', 'count'].includes(x.type)));
	const [first, second] = rep;
	if (first && second?.times) {
		const sign = first.better === 'less' ? -1 : 1;
		let top: { w: number; reps: number } | null = null;
		for (const l of logs)
			for (const s of l.sets) {
				const w = Number(s[first.id]);
				const n = Number(s[second.id]);
				if (!Number.isFinite(w) || !Number.isFinite(n) || !n) continue;
				if (!top || (w - top.w) * sign > 0 || (w === top.w && n > top.reps)) top = { w, reps: n };
			}
		return top ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(top.w)}${first.unit ? ` ${first.unit}` : ''} × ${top.reps}` : null;
	}
	const m = (P.metricsByTask.get(taskId) ?? []).find((x) => !x.repeats && ['number', 'duration', 'count'].includes(x.type));
	if (!m) return null;
	const vs = logs.flatMap((l) => singleRows(l).map((row) => Number(row[m.id]))).filter((v) => Number.isFinite(v) && v > 0);
	if (!vs.length) return null;
	const best = Math.max(...vs);
	return `${formatValue(best, m.type === 'duration' ? (m.unit || 'min') : (m.unit ?? ''), m.type === 'duration' && (!m.unit || m.unit === 'min') ? 'duration' : 'number')} ${m.name.toLowerCase()}`;
}
