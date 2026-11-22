import { and, desc, eq, gte, inArray, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { entry, habit, metric, occurrence, slip, task, variant } from '$lib/server/db/schema';
import { optionName, type ChoiceOption } from '$lib/options';
import { getSettings, getViews } from '$lib/server/settings';
import { listAreas } from '$lib/server/repo/areas';
import { initialState } from '$lib/views';
import { settleAll, userToday } from '$lib/server/today';
import { addDays } from '$lib/engine/dates';
import { progressForIds } from '$lib/server/progress';
import { isPartial, progressText } from '$lib/engine/progress';
import { rollupText } from '$lib/engine/rollup';
import { excerpt } from '$lib/markdown';
import { isHidden } from '$lib/views';
import type { PageServerLoad } from './$types';

const DAYS = 90;

export const load: PageServerLoad = ({ locals, cookies, url }) => {
	const accountId = locals.account!.id;
	const days = Math.min(Number(url.searchParams.get('days')) || DAYS, 3650);
	const today = userToday(accountId, cookies.get('tz'));
	const from = addDays(today, -days);
	// Days nobody logged show as missed here too.
	settleAll(accountId, today);

	const occ = db
		.select({
			id: occurrence.id,
			date: occurrence.date,
			status: occurrence.status,
			notes: occurrence.notes,
			habitId: habit.id,
			habit: habit.name,
			areaId: habit.areaId,
			variant: variant.name,
			rollup: occurrence.rollup
		})
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.leftJoin(variant, eq(occurrence.variantId, variant.id))
		.where(and(eq(habit.accountId, accountId), ne(occurrence.status, 'due'), gte(occurrence.date, from)))
		.orderBy(desc(occurrence.date))
		.all();
	const entries = occ.length
		? db
				.select({ occurrenceId: entry.occurrenceId, taskId: entry.taskId, task: task.name, values: entry.values })
				.from(entry)
				.innerJoin(task, eq(entry.taskId, task.id))
				.where(inArray(entry.occurrenceId, occ.map((o) => o.id)))
				.orderBy(entry.sortOrder)
				.all()
		: [];
	const metrics = entries.length
		? db
				.select({ id: metric.id, taskId: metric.taskId, name: metric.name, type: metric.type, unit: metric.unit, choices: metric.choices })
				.from(metric)
				.where(inArray(metric.taskId, [...new Set(entries.map((e) => e.taskId))]))
				.orderBy(metric.sortOrder)
				.all()
		: [];
	const slips = db
		.select({ date: slip.date, count: slip.count, habit: habit.name, habitId: habit.id, areaId: habit.areaId })
		.from(slip)
		.innerJoin(habit, eq(slip.habitId, habit.id))
		.where(and(eq(habit.accountId, accountId), gte(slip.date, from)))
		.orderBy(desc(slip.date))
		.all();

	// Only name the Variant when a habit has more than one.
	const multi = new Set(
		db
			.select({ habitId: variant.habitId })
			.from(variant)
			.innerJoin(habit, eq(variant.habitId, habit.id))
			.where(eq(habit.accountId, accountId))
			.all()
			.map((v) => v.habitId)
			.filter((id, i, all) => all.indexOf(id) !== i)
	);
	for (const o of occ) if (!multi.has(o.habitId)) o.variant = null;

	// One row per day, newest first.
	const byDay = new Map<string, { occurrences: typeof occ; slips: typeof slips }>();
	const day = (d: string) => byDay.get(d) ?? byDay.set(d, { occurrences: [], slips: [] }).get(d)!;
	occ.forEach((o) => day(o.date).occurrences.push(o));
	slips.forEach((s) => day(s.date).slips.push(s));

	const views = getViews(accountId);
	const entryCounts = Object.fromEntries(occ.map((o) => [o.id, entries.filter((c) => c.occurrenceId === o.id).length]));
	return {
		days,
		today,
		/** Past days can be logged (a Settings option); history only lists days with something logged. */
		canBackfill: getSettings(accountId).pastDays !== 0,
		/** The Journal page sits next to History, unless the Journal feature is off. */
		journal: !isHidden(views, 'journal'),
		entryCounts,
		/**
		 * "3 of 6 glasses" or "2 of 4 steps" for logs that fell short, by Occurrence id: a done day
		 * that counted at its Minimum, or a missed day that got part of the way.
		 */
		partial: Object.fromEntries([
			...[...progressForIds(occ.filter((o) => o.status === 'done' || (o.status === 'missed' && entryCounts[o.id])).map((o) => o.id))]
				.filter(([, p]) => isPartial(p))
				.map(([id, p]) => [id, progressText(p)]),
			// A group's day: how many of the habits inside were done.
			...occ.filter((o) => o.rollup && o.status !== 'skipped').map((o) => [o.id, rollupText(o.rollup!)])
		]),
		// What was logged, one line per Task, for "Show values" in History.
		values: Object.fromEntries(occ.map((o) => [o.id, summarize(entries.filter((e) => e.occurrenceId === o.id), metrics)])),
		habits: db
			.select({ id: habit.id, name: habit.name })
			.from(habit)
			.where(eq(habit.accountId, accountId))
			.orderBy(habit.name)
			.all(),
		areas: listAreas(accountId),
		views,
		initial: initialState(views, 'history'),
		history: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
	};
};

type Metric = { id: string; taskId: string; name: string; type: string; unit: string | null; choices: ChoiceOption[] | null };

/** "Bench press: 80 kg × 8, 80 kg × 8" — one line per Task, sets in order. */
function summarize(entries: { taskId: string; task: string; values: Record<string, unknown> }[], metrics: Metric[]): string[] {
	const byTask = new Map<string, { task: string; sets: string[] }>();
	for (const e of entries) {
		const parts = metrics
			.filter((m) => m.taskId === e.taskId)
			.map((m) => {
				const v = e.values[m.id];
				if (v === undefined || v === null || v === '' || v === false) return null;
				if (v === true) return m.name;
				// Text can be a whole journal entry: the start of it is enough here.
				if (m.type === 'text' && typeof v === 'string') return `${m.name}: ${excerpt(v, 60)}`;
				if (m.type === 'choice') return optionName(m.choices, v);
				return `${v}${m.unit ? ` ${m.unit}` : ''}`;
			})
			.filter(Boolean);
		if (!parts.length) continue;
		const t = byTask.get(e.taskId) ?? byTask.set(e.taskId, { task: e.task, sets: [] }).get(e.taskId)!;
		t.sets.push(parts.join(' × '));
	}
	return [...byTask.values()].map((t) => `${t.task}: ${t.sets.join(', ')}`);
}
