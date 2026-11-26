import { and, desc, eq, gte, inArray, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { entry, habit, metric, occurrence, slip, task, variant } from '$lib/server/db/schema';
import { optionName, type ChoiceOption } from '$lib/options';
import { getSettings, getViews } from '$lib/server/settings';
import { listAreas } from '$lib/server/repo/areas';
import { areaOn } from '$lib/engine/dated';
import { initialState } from '$lib/views';
import { settleAll, userToday } from '$lib/server/today';
import { addDays, daysBetween } from '$lib/engine/dates';
import { getDayNote, hasJournal, loadJournal } from '$lib/server/journal';
import { matches, onThisDay } from '$lib/journal';
import { earliestLoggable } from '$lib/engine/backfill';
import { progressForIds } from '$lib/server/progress';
import { isPartial, progressText } from '$lib/engine/progress';
import { rollupText } from '$lib/engine/rollup';
import { excerpt } from '$lib/markdown';
import { joinRow } from '$lib/rowtext';
import { isHidden } from '$lib/views';
import type { PageServerLoad } from './$types';

const DAYS = 90;

export const load: PageServerLoad = ({ locals, cookies, url }) => {
	const accountId = locals.account!.id;
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	const mood = (url.searchParams.get('mood') ?? '').slice(0, 100);
	const notesOnly = url.searchParams.has('notes');
	// A search looks through everything; browsing shows the last few months.
	const days = q || mood ? 3650 : Math.max(1, Math.min(Math.round(Number(url.searchParams.get('days'))) || DAYS, 3650));
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
			earlierAreas: habit.earlierAreas,
			variant: variant.name,
			rollup: occurrence.rollup,
			level: occurrence.level,
			extra: occurrence.extra,
			scoring: habit.scoring,
			levels: habit.levels
		})
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.leftJoin(variant, eq(occurrence.variantId, variant.id))
		.where(and(eq(habit.accountId, accountId), ne(occurrence.status, 'due'), gte(occurrence.date, from)))
		.orderBy(desc(occurrence.date))
		.all();
	// Today's habits still to do: not rows here, but today's count is of all that is due, as on Today.
	const openToday = db
		.select({ status: occurrence.status, extra: occurrence.extra, rollup: occurrence.rollup, scoring: habit.scoring, habitId: habit.id, areaId: habit.areaId })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(and(eq(habit.accountId, accountId), eq(occurrence.status, 'due'), eq(occurrence.date, today)))
		.all();
	const slips = db
		.select({ date: slip.date, count: slip.count, habit: habit.name, habitId: habit.id, areaId: habit.areaId, earlierAreas: habit.earlierAreas })
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
	// A day is filed under the Area its habit had that day.
	for (const x of [...occ, ...slips]) [x.areaId, x.earlierAreas] = [areaOn(x, x.date), null];

	// What was written, by day: the journal is this list with notes only.
	const settings = getSettings(accountId);
	const journalOn = !isHidden(getViews(accountId), 'journal');
	const written = journalOn ? loadJournal(accountId, { from, to: today }, { today }) : [];
	const notesOf = new Map(written.map((d) => [d.date, d]));

	// One row per day, newest first.
	const byDay = new Map<string, { occurrences: typeof occ; slips: typeof slips }>();
	const day = (d: string) => byDay.get(d) ?? byDay.set(d, { occurrences: [], slips: [] }).get(d)!;
	occ.forEach((o) => day(o.date).occurrences.push(o));
	slips.forEach((s) => day(s.date).slips.push(s));
	for (const d of written) if (d.items.length || d.moods.length) day(d.date);

	// A search keeps the days whose writing or habits hold every word.
	const words = q.toLowerCase().split(/\s+/).filter(Boolean);
	const kept = ([date, d]: [string, { occurrences: typeof occ; slips: typeof slips }]) => {
		const w = notesOf.get(date);
		if (mood && !w?.moods.some((m) => m.value === mood)) return false;
		if (notesOnly && !w) return false;
		if (!words.length) return true;
		if (w && matches(w, q)) return true;
		return !notesOnly && words.every((x) => [...d.occurrences, ...d.slips].some((o) => o.habit.toLowerCase().includes(x)));
	};
	// A search can match years: the newest that match are enough to look through, and to load.
	const shown = [...byDay.entries()].filter(kept).sort((a, b) => b[0].localeCompare(a[0])).slice(0, q || mood ? 120 : undefined);
	const shownOcc = shown.flatMap(([, d]) => d.occurrences);
	// A few thousand at a time: one statement holds only so many ids.
	const entries = [];
	for (let i = 0; i < shownOcc.length; i += 5000)
		entries.push(
			...db
				.select({ occurrenceId: entry.occurrenceId, taskId: entry.taskId, task: task.name, values: entry.values })
				.from(entry)
				.innerJoin(task, eq(entry.taskId, task.id))
				.where(inArray(entry.occurrenceId, shownOcc.slice(i, i + 5000).map((o) => o.id)))
				.orderBy(entry.sortOrder)
				.all()
		);
	const metrics = entries.length
		? db
				.select({ id: metric.id, taskId: metric.taskId, name: metric.name, type: metric.type, unit: metric.unit, times: metric.times, choices: metric.choices })
				.from(metric)
				.where(inArray(metric.taskId, [...new Set(entries.map((e) => e.taskId))]))
				.orderBy(metric.sortOrder)
				.all()
		: [];
	const entriesOf = Map.groupBy(entries, (e) => e.occurrenceId);
	const lookBack =
		notesOnly && !q && !mood
			? onThisDay(today)
					.map((x) => ({ ...x, day: loadJournal(accountId, { from: x.date, to: x.date }, { today })[0] ?? null, href: `?notes&days=${Math.max(days, daysBetween(x.date, today) + 1)}#d-${x.date}` }))
					.filter((x) => x.day)
			: [];

	const views = getViews(accountId);
	const entryCounts = Object.fromEntries(shownOcc.map((o) => [o.id, entriesOf.get(o.id)?.length ?? 0]));
	return {
		days,
		today,
		/** Past days can be logged (a Settings option); history only lists days with something logged. */
		canBackfill: settings.pastDays !== 0,
		/** The first day that can still be logged, when Settings limit it. */
		windowFrom: earliestLoggable(today, settings.pastDays),
		q,
		mood,
		notesOnly,
		notes: Object.fromEntries(written.map((d) => [d.date, { items: d.items, moods: d.moods }])),
		moods: [...new Set(written.flatMap((d) => d.moods.map((m) => m.value)))],
		lookBack,
		ready: url.searchParams.get('ready'),
		dayNote: notesOnly && settings.dayNote && journalOn ? getDayNote(accountId, today) : null,
		setup: journalOn && (url.searchParams.has('setup') || (notesOnly && !written.length && !hasJournal(accountId) && !settings.dayNote)) ? { hasJournal: hasJournal(accountId), dayNote: settings.dayNote } : null,
		/** The Journal page sits next to History, unless the Journal feature is off. */
		journal: journalOn,
		entryCounts,
		/**
		 * "3 of 6 glasses" or "2 of 4 steps" for logs that fell short, by Occurrence id: a done day
		 * that counted at its Minimum, or a missed day that got part of the way.
		 */
		partial: Object.fromEntries([
			...[...progressForIds(shownOcc.filter((o) => o.status === 'done' || (o.status === 'missed' && entryCounts[o.id])).map((o) => o.id))]
				.filter(([, p]) => isPartial(p))
				.map(([id, p]) => [id, progressText(p)]),
			// A group's day: how many of the habits inside were done.
			...shownOcc.filter((o) => o.rollup && o.status !== 'skipped').map((o) => [o.id, rollupText(o.rollup!)])
		]),
		// What was logged, one line per Task, for "Show values" in History.
		values: Object.fromEntries(shownOcc.map((o) => [o.id, summarize(entriesOf.get(o.id) ?? [], metrics)])),
		habits: db
			.select({ id: habit.id, name: habit.name })
			.from(habit)
			.where(eq(habit.accountId, accountId))
			.orderBy(habit.name)
			.all(),
		areas: listAreas(accountId),
		views,
		initial: initialState(views, 'history'),
		/** The last seven days, whether or not anything was logged, for the strip. */
		strip: Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)),
		history: shown,
		openToday
	};
};

type Metric = { id: string; taskId: string; name: string; type: string; unit: string | null; times: boolean; choices: ChoiceOption[] | null };

/** "Bench press: 80 kg × 8, 80 kg × 8" — one line per Task, sets in order. */
function summarize(entries: { taskId: string; task: string; values: Record<string, unknown> }[], metrics: Metric[]): string[] {
	const byTask = new Map<string, { task: string; sets: string[] }>();
	for (const e of entries) {
		const said = (m: Metric): string | null => {
				const v = e.values[m.id];
				if (v === undefined || v === null || v === '' || v === false) return null;
				if (v === true) return m.name;
				// Text can be a whole journal entry: the start of it is enough here.
				if (m.type === 'text' && typeof v === 'string') return `${m.name}: ${excerpt(v, 60)}`;
				if (m.type === 'choice') return optionName(m.choices, v);
				return `${v}${m.unit ? ` ${m.unit}` : ''}`;
			};
		const row = joinRow(metrics.filter((m) => m.taskId === e.taskId).map((m) => ({ text: said(m) ?? '', times: m.times })));
		if (!row) continue;
		const t = byTask.get(e.taskId) ?? byTask.set(e.taskId, { task: e.task, sets: [] }).get(e.taskId)!;
		t.sets.push(row);
	}
	return [...byTask.values()].map((t) => `${t.task}: ${t.sets.join(', ')}`);
}
