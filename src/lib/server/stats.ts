// Everything an account logged, in the shape the stats engine reads, plus the stored boards.
// One read per table: the engine does the rest in memory, so a card never needs its own query.
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { area, craving, entry, habit, habitIdentity, identity, metric, occurrence, slip, slot, tag, task, taskTag, variant } from './db/schema';
import { getSettings, getViews, saveSettings } from './settings';
import { timeIn, userToday } from './today';
import { listAreas } from './repo/areas';
import { listIdentities } from './repo/identities';
import { computeCard, prepare, type CardResult, type Ctx, type Dataset, type Prepared } from '$lib/stats/engine';
import { readStats, statsSettings, type Board, type StatCard, type StatsSettings } from '$lib/stats/model';
import { startingBoards } from '$lib/stats/auto';
import { catalogOf, statCtx, type Catalog } from '$lib/stats/catalog';
import { checkCard } from '$lib/rules/stats';
import { DEFAULT_STREAK_RULE } from '$lib/engine/streak';

export function loadDataset(accountId: string, tz?: string): Dataset {
	const s = getSettings(accountId);
	const zone = tz || s.timeZone;
	const today = userToday(accountId, tz);

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
	const done = occs.filter((o) => o.status === 'done').map((o) => o.id);
	// Large accounts: read entries in chunks so the IN list stays within SQLite's limit.
	const entries: (typeof entry.$inferSelect)[] = [];
	for (let i = 0; i < done.length; i += 900)
		entries.push(...db.select().from(entry).where(inArray(entry.occurrenceId, done.slice(i, i + 900))).all());
	const slips = habitIds.length ? db.select().from(slip).where(inArray(slip.habitId, habitIds)).all() : [];
	const cravings = habitIds.length ? db.select().from(craving).where(inArray(craving.habitId, habitIds)).all() : [];
	const areas = db.select({ id: area.id, name: area.name }).from(area).where(eq(area.accountId, accountId)).all();

	return {
		today,
		weightUnit: s.weightUnit || 'kg',
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
			limit: h.limit ?? null
		})),
		tasks: tasks.map((t) => ({
			id: t.id,
			name: t.name,
			areaId: t.areaId,
			parentTaskId: t.parentTaskId,
			archived: t.archived,
			tags: tags.filter((x) => x.taskId === t.id).map((x) => ({ name: x.name, level: x.level }))
		})),
		metrics: metrics.map((m) => ({ id: m.id, taskId: m.taskId, name: m.name, type: m.type, unit: m.unit, repeats: m.repeats, choices: m.choices ?? null })),
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
			// Logged for another day (past-day logging): the finish time says nothing about when it happened.
			time: o.finishedAt && timeIn(zone, o.finishedAt) && sameDay(o.finishedAt, o.date, zone) ? timeIn(zone, o.finishedAt) : null
		})),
		entries: entries.map((e) => ({ occurrenceId: e.occurrenceId, taskId: e.taskId, values: e.values ?? {}, sortOrder: e.sortOrder })),
		slips: slips.map((x) => ({ habitId: x.habitId, date: x.date, count: x.count, time: x.time })),
		cravings: cravings.map((x) => ({ habitId: x.habitId, date: x.date, time: x.time }))
	};
}

/** Was `at` on `date` (or just after midnight of it, for a day that starts late) in the user's zone? */
function sameDay(at: Date, date: string, zone: string | undefined): boolean {
	let d: string;
	try {
		d = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(at);
	} catch {
		d = at.toISOString().slice(0, 10);
	}
	if (d === date) return true;
	// A log at 01:00 for a day that starts at 04:00 belongs to the day before.
	const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
	return d === next && timeIn(zone, at) < '06:00';
}

export function getStats(accountId: string): StatsSettings {
	return readStats(getSettings(accountId).stats);
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
		settings: { muscle: s.muscle, e1rm: s.e1rm, e1rmMaxReps: s.e1rmMaxReps, measures: s.measures }
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
