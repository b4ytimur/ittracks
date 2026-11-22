// Reading for AI assistants and scripts: what exists (habits, Tasks, fields and units), the logs
// one row per habit and day, and every logged value one row each (a tidy table that suits
// spreadsheets, pandas and an assistant's own code). Every row carries a ref such as
// "log:<id>" that get_record opens, so an answer can cite exactly what it is based on.
// Notes, journal entries and text fields need the notes scope; without it they are left out.
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../db';
import { area, dayNote, entry, habit, metric, occurrence, slip, slot, tag, task, taskPart, taskTag, variant } from '../db/schema';
import { parsePath } from '$lib/engine/parts';
import { getSettings } from '../settings';
import { getStats, loadDataset } from '../stats';
import { ensureToday, settleAll, userToday } from '../today';
import { prepare, describeLog, type Dataset, type Prepared } from '$lib/stats/engine';
import { describeSchedule, groupRuleText } from '$lib/describe';
import { progressText } from '$lib/engine/progress';
import { rollupText } from '$lib/engine/rollup';
import { progressForIds } from '../progress';
import { streak, type StreakRule } from '$lib/engine/streak';
import { addDays, weekday } from '$lib/engine/dates';
import { excerpt } from '$lib/markdown';
import type { ScheduleForm } from '$lib/forms';
import { isGroup, isPhases, phaseSpans, rollupRuleOf, variantsIn, type Phases, type Schedule } from '$lib/engine/schedule';
import { ActionError, canSeeHabit, requireScope, type Actor } from './actor';
import { dayOf, findHabit, visibleHabits } from './day';
import { listEvents } from './events';
import { activeOptions, optionName, scoresOn } from '$lib/options';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
type Values = Record<string, unknown>;

/**
 * Everything this actor may read, prepared for the stats engine: only its habits, and without
 * text values unless it has the notes scope. Misses are settled first, as Stats does.
 */
export function preparedFor(actor: Actor): Prepared {
	settleAll(actor.accountId, userToday(actor.accountId, actor.tz));
	const ds = loadDataset(actor.accountId, actor.tz);
	return prepare(limitDataset(actor, ds));
}

export function limitDataset(actor: Actor, ds: Dataset): Dataset {
	const notes = actor.scopes.has('notes');
	const text = new Set(ds.metrics.filter((m) => m.type === 'text').map((m) => m.id));
	const habits = ds.habits.filter((h) => canSeeHabit(actor, h.id));
	const ok = new Set(habits.map((h) => h.id));
	const occs = ds.occurrences.filter((o) => ok.has(o.habitId));
	const occOk = new Set(occs.map((o) => o.id));
	return {
		...ds,
		habits,
		variants: ds.variants.filter((v) => ok.has(v.habitId)),
		occurrences: occs,
		entries: ds.entries
			.filter((e) => occOk.has(e.occurrenceId))
			.map((e) => (notes ? e : { ...e, values: Object.fromEntries(Object.entries(e.values).filter(([k]) => !text.has(k))) })),
		slips: ds.slips.filter((s) => ok.has(s.habitId)),
		cravings: ds.cravings.filter((c) => ok.has(c.habitId))
	};
}

/** A range of days: `from`/`to` (YYYY-MM-DD), or the last `days` days, ending today. */
export function rangeOf(actor: Actor, input: { from?: string | null; to?: string | null; days?: number | null }, fallbackDays = 30) {
	const today = userToday(actor.accountId, actor.tz);
	const to = input.to ? dayOf(actor, input.to).date : today;
	const from = input.from ? dayOf(actor, input.from).date : addDays(to, -((input.days ?? fallbackDays) - 1));
	if (from > to) throw new ActionError('invalid', `from (${from}) is after to (${to}).`);
	return { from, to, today };
}

const metricUnit = (m: { unit: string | null; type: string }) => (m.unit && m.unit.trim() ? m.unit : m.type === 'duration' ? 'min' : null);

// ---------- describe ----------

/** What there is to ask about: habits, Tasks and their fields with units, Areas, tags, and the data's date range. */
export function describe(actor: Actor) {
	requireScope(actor, 'read');
	const s = getSettings(actor.accountId);
	const today = userToday(actor.accountId, actor.tz);
	const habits = visibleHabits(actor, { archived: true });
	const ids = habits.map((h) => h.id);
	const variants = ids.length ? db.select().from(variant).where(inArray(variant.habitId, ids)).orderBy(asc(variant.sortOrder)).all() : [];
	const slotRows = variants.length
		? db.select().from(slot).where(inArray(slot.variantId, variants.map((v) => v.id))).orderBy(asc(slot.sortOrder)).all()
		: [];
	/** The habit a habit sits in, with its Variants, so "follows its routine" reads with names. */
	const parentFor = (id: string | null) => {
		const p = id ? habits.find((x) => x.id === id) : undefined;
		return p ? { name: p.name, variants: variants.filter((v) => v.habitId === p.id).map((v) => ({ id: v.id, name: v.name })) } : undefined;
	};
	const allTasks = db.select().from(task).where(eq(task.accountId, actor.accountId)).orderBy(asc(task.sortOrder), asc(task.name)).all();
	const allParts = db
		.select({ p: taskPart })
		.from(taskPart)
		.innerJoin(task, eq(taskPart.taskId, task.id))
		.where(and(eq(task.accountId, actor.accountId), eq(taskPart.archived, false)))
		.orderBy(asc(taskPart.sortOrder))
		.all()
		.map((r) => r.p);
	// A key limited to some habits sees only the Tasks those habits use, and what is inside them.
	const used = new Set(slotRows.map((x) => x.taskId).filter((x): x is string => !!x));
	for (let grew = true; grew; ) {
		grew = false;
		for (const p of allParts)
			if (used.has(p.taskId) && !used.has(p.childTaskId)) {
				used.add(p.childTaskId);
				grew = true;
			}
	}
	const tasks = actor.habitIds ? allTasks.filter((t) => used.has(t.id) || (t.parentTaskId && used.has(t.parentTaskId))) : allTasks;
	const taskIds = tasks.map((t) => t.id);
	const metrics = taskIds.length ? db.select().from(metric).where(inArray(metric.taskId, taskIds)).orderBy(asc(metric.sortOrder)).all() : [];
	const tags = taskIds.length
		? db.select({ taskId: taskTag.taskId, name: tag.name, level: taskTag.level }).from(taskTag).innerJoin(tag, eq(taskTag.tagId, tag.id)).where(inArray(taskTag.taskId, taskIds)).all()
		: [];
	const areas = db.select({ id: area.id, name: area.name }).from(area).where(eq(area.accountId, actor.accountId)).all();
	const areaName = new Map(areas.map((a) => [a.id, a.name]));
	const taskName = new Map(allTasks.map((t) => [t.id, t.name]));
	const counts = ids.length
		? db
				.select({ habitId: occurrence.habitId, status: occurrence.status, date: occurrence.date })
				.from(occurrence)
				.where(inArray(occurrence.habitId, ids))
				.all()
		: [];
	const slipRows = ids.length ? db.select({ habitId: slip.habitId, count: slip.count, date: slip.date }).from(slip).where(inArray(slip.habitId, ids)).all() : [];
	const dates = [...counts.filter((c) => c.status !== 'due').map((c) => c.date), ...slipRows.map((x) => x.date)].sort();
	const levelName = ['', 'low', 'medium', 'high'];

	return {
		apiVersion: 1,
		today,
		timeZone: actor.tz ?? s.timeZone ?? null,
		dayStart: s.dayStart ?? '00:00',
		weightUnit: s.weightUnit,
		data: { firstDay: dates[0] ?? null, lastDay: dates.at(-1) ?? null },
		access: { scopes: [...actor.scopes], allHabits: !actor.habitIds },
		privacy: actor.scopes.has('notes') ? 'Notes, journal entries and text fields are included.' : 'Notes, journal entries and text field values are left out (this key has no notes access).',
		habits: habits.map((h) => {
			const mine = counts.filter((c) => c.habitId === h.id);
			const n = (st: string) => mine.filter((c) => c.status === st).length;
			return {
				ref: `habit:${h.id}`,
				id: h.id,
				name: h.name,
				direction: h.direction,
				area: h.areaId ? (areaName.get(h.areaId) ?? null) : null,
				archived: h.archived,
				startDate: h.startDate,
				schedule:
					h.direction === 'build'
						? describeSchedule(h.schedule as ScheduleForm | null, parentFor(h.parentId), variants.filter((v) => v.habitId === h.id))
						: 'Break habit: log slips',
				// Phases: each one's dates and schedule, so "which phase was I in" can be answered exactly.
				...(isPhases(h.schedule as Schedule | null)
					? {
							phases: phaseSpans(h.schedule as Phases).map((p) => ({
								from: p.from,
								to: p.to,
								schedule: describeSchedule(p.schedule as ScheduleForm),
								variants: variantsIn(p.schedule).map((id) => variants.find((v) => v.id === id)?.name ?? id),
								current: today >= p.from && (p.to === null || today <= p.to)
							}))
						}
					: {}),
				// The feelings a slip can be logged with (log_slip takes one by name or id).
				...(h.direction === 'break' ? { feelings: activeOptions(h.triggers).map((o) => ({ id: o.id, name: o.name })) } : {}),
				// A group's days are worked out from the habits inside it; it can't be logged itself.
				...(isGroup(h.schedule as Schedule | null) ? { group: { inside: habits.filter((x) => x.parentId === h.id).map((x) => x.name) } } : {}),
				// A routine has days of its own; on them it is judged from the habits inside, and log_done
				// or skip on it marks them.
				...(!isGroup(h.schedule as Schedule | null) && habits.some((x) => x.parentId === h.id && x.direction === 'build')
					? { routine: { inside: habits.filter((x) => x.parentId === h.id).map((x) => x.name), rule: groupRuleText(rollupRuleOf(h.schedule as Schedule)) } }
					: {}),
				...(h.parentId ? { inGroup: habits.find((x) => x.id === h.parentId)?.name ?? null } : {}),
				streakRule: (h.streakRule as StreakRule).kind,
				variants: variants
					.filter((v) => v.habitId === h.id)
					.map((v) => ({
						id: v.id,
						name: v.name,
						tasks: slotRows
							.filter((x) => x.variantId === v.id)
							.map((x) => ({
								taskId: x.taskId,
								task: x.taskId ? (taskName.get(x.taskId) ?? null) : null,
								autoFilled: !!x.fillRule,
								sets: x.sets,
								targets: Object.fromEntries(
									Object.entries((x.targets as Record<string, number> | null) ?? {}).map(([k, v]) => [metrics.find((m) => m.id === k)?.name ?? k, v])
								)
							}))
					})),
				totals:
					h.direction === 'build'
						? { done: n('done'), missed: n('missed'), skipped: n('skipped') }
						: { slips: slipRows.filter((x) => x.habitId === h.id).reduce((a, x) => a + x.count, 0) }
			};
		}),
		tasks: tasks.map((t) => ({
			ref: `task:${t.id}`,
			id: t.id,
			name: t.name,
			// A step: private to the Task it is inside.
			parent: t.parentTaskId ? (taskName.get(t.parentTaskId) ?? null) : null,
			// What sits inside it, in order: steps, and Library Tasks with their sets (rounds, on a
			// Task without per-set fields of its own) and targets. Log them as "Task › Part".
			...(allParts.some((p) => p.taskId === t.id)
				? {
						inside: allParts
							.filter((p) => p.taskId === t.id)
							.map((p) => ({
								taskId: p.childTaskId,
								task: taskName.get(p.childTaskId) ?? null,
								step: p.id === p.childTaskId,
								sets: p.sets,
								targets: Object.fromEntries(Object.entries(p.targets ?? {}).map(([k, v]) => [metrics.find((m) => m.id === k)?.name ?? k, v]))
							}))
					}
				: {}),
			area: t.areaId ? (areaName.get(t.areaId) ?? null) : null,
			archived: t.archived,
			tags: tags.filter((x) => x.taskId === t.id).map((x) => `${x.name} (${levelName[x.level] ?? x.level})`),
			fields: metrics
				.filter((m) => m.taskId === t.id)
				.map((m) => ({
					id: m.id,
					name: m.name,
					type: m.type,
					unit: metricUnit(m),
					perSet: m.repeats,
					// Removed from the Task after it was logged: its past values are still in the logs.
					...(m.archived ? { archived: true } : {}),
					// Each option with its id (logs store it) and its number, if it has one. An archived
					// option was removed after it was logged: past values still name it.
					...(m.type === 'choice'
						? {
								options: (m.choices ?? []).map((o) => ({
									id: o.id,
									name: o.name,
									...(typeof m.scores?.[o.id] === 'number' ? { score: m.scores[o.id] } : {}),
									...(o.archived ? { archived: true } : {})
								}))
							}
						: {}),
					...(m.earlierScores?.length ? { earlierScores: m.earlierScores } : {})
				}))
		})),
		areas: areas.map((a) => a.name),
		customMeasures: getStats(actor.accountId).measures.map((m) => ({ id: `custom:${m.id}`, name: m.name, formula: m.formula, unit: m.unit }))
	};
}

// ---------- logs ----------

export interface LogRow {
	ref: string;
	kind: 'log' | 'slip' | 'craving';
	date: string;
	weekday: string;
	habitId: string;
	habit: string;
	status?: string;
	variant?: string | null;
	level?: string | null;
	extra?: boolean;
	progress?: string | null;
	summary?: string;
	count?: number;
	time?: string | null;
	feeling?: string | null;
	place?: string | null;
	notes?: string | null;
}

/** One row per habit and day (plus one per slip and resisted craving), newest first. */
export function listLogs(
	actor: Actor,
	input: { from?: string | null; to?: string | null; days?: number | null; habits?: string[]; status?: string[]; limit?: number; cursor?: string | null; all?: boolean }
) {
	requireScope(actor, 'read');
	const notes = actor.scopes.has('notes');
	const { from, to } = rangeOf(actor, input);
	const P = preparedFor(actor);
	const wanted = input.habits?.length ? new Set(input.habits.map((r) => findHabit(actor, r).id)) : null;
	const okHabit = (id: string) => !wanted || wanted.has(id);
	const inRange = (d: string) => d >= from && d <= to;
	const occRows = P.ds.occurrences.filter((o) => inRange(o.date) && okHabit(o.habitId) && (!input.status?.length || input.status.includes(o.status)));
	const occNotes = notes && occRows.length
		? new Map(
				db
					.select({ id: occurrence.id, notes: occurrence.notes })
					.from(occurrence)
					.innerJoin(habit, eq(occurrence.habitId, habit.id))
					.where(and(eq(habit.accountId, actor.accountId), gte(occurrence.date, from), lte(occurrence.date, to)))
					.all()
					.map((r) => [r.id, r.notes])
			)
		: new Map<string, string | null>();
	const logsByOcc = new Map<string, typeof P.logs>();
	for (const l of P.logs) logsByOcc.set(l.occ.id, [...(logsByOcc.get(l.occ.id) ?? []), l]);
	const progress = progressForIds(occRows.filter((o) => o.status !== 'skipped').map((o) => o.id));
	const rows: LogRow[] = occRows.map((o) => {
		const h = P.habits.get(o.habitId)!;
		const logs = logsByOcc.get(o.id) ?? [];
		const p = progress.get(o.id);
		return {
			ref: `log:${o.id}`,
			kind: 'log',
			date: o.date,
			weekday: WEEKDAYS[weekday(o.date)],
			habitId: h.id,
			habit: h.name,
			status: o.status,
			variant: o.variantId ? (P.variants.get(o.variantId)?.name ?? null) : null,
			level: o.level ?? (o.status === 'done' ? 'target' : null),
			progress: p ? progressText(p) : o.rollup ? rollupText(o.rollup) : null,
			summary: logs.map((l) => `${l.task.name}: ${describeLog(l, P)}`).join(' | ') || undefined,
			time: o.time,
			...(notes && occNotes.get(o.id) ? { notes: occNotes.get(o.id) } : {})
		};
	});
	if (!input.status?.length || input.status.includes('slip')) {
		const slips = P.ds.slips.length
			? db
					.select({ s: slip, triggers: habit.triggers })
					.from(slip)
					.innerJoin(habit, eq(slip.habitId, habit.id))
					.where(and(eq(habit.accountId, actor.accountId), gte(slip.date, from), lte(slip.date, to)))
					.all()
			: [];
		for (const { s, triggers } of slips) {
			if (!canSeeHabit(actor, s.habitId) || !okHabit(s.habitId)) continue;
			rows.push({
				ref: `slip:${s.id}`,
				kind: 'slip',
				date: s.date,
				weekday: WEEKDAYS[weekday(s.date)],
				habitId: s.habitId,
				habit: P.habits.get(s.habitId)?.name ?? '',
				count: s.count,
				time: s.time,
				feeling: optionName(triggers, s.feeling),
				place: s.place,
				...(notes && s.notes ? { notes: s.notes } : {})
			});
		}
	}
	if (!input.status?.length || input.status.includes('craving')) {
		for (const c of P.ds.cravings) {
			if (!inRange(c.date) || !okHabit(c.habitId)) continue;
			rows.push({ ref: `craving:${c.date}`, kind: 'craving', date: c.date, weekday: WEEKDAYS[weekday(c.date)], habitId: c.habitId, habit: P.habits.get(c.habitId)?.name ?? '', time: c.time });
		}
	}
	rows.sort((a, b) => b.date.localeCompare(a.date) || a.habit.localeCompare(b.habit));
	return page(rows, input, { from, to });
}

/** A page of rows. `all` (only from inside the server, e.g. the export) returns every row. */
function page<T>(rows: T[], input: { limit?: number; cursor?: string | null; all?: boolean }, extra: Record<string, unknown>, max = 2000) {
	const offset = Math.max(0, Number(input.cursor ?? 0) || 0);
	const limit = input.all ? Math.max(rows.length, 1) : Math.min(Math.max(input.limit ?? 200, 1), max);
	const slice = rows.slice(offset, offset + limit);
	return { ...extra, total: rows.length, returned: slice.length, next: offset + limit < rows.length ? String(offset + limit) : null, rows: slice };
}

// ---------- values ----------

export interface ValueRow {
	ref: string;
	date: string;
	weekday: string;
	habitId: string;
	habit: string;
	status: string;
	variant: string | null;
	level: string | null;
	taskId: string;
	/** The Task, or for a Task inside another its place: "Circuit › Push-ups". */
	task: string;
	/** 1, 2, 3… for a value logged per set; null for one logged once per log. */
	set: number | null;
	/** The round of a Circuit it was logged in, from 1; null outside rounds. */
	round: number | null;
	fieldId: string;
	field: string;
	type: string;
	unit: string | null;
	value: number | string | boolean;
	/** A choice's number (mood 5 to 1), when it has one. */
	score: number | null;
}

/**
 * Every logged value, one row each: the tidy "long" table. Sub-task ticks come as a
 * field "Done" of the sub-task. Logs still in progress are included, with their status.
 */
export function listValues(
	actor: Actor,
	input: { from?: string | null; to?: string | null; days?: number | null; habits?: string[]; tasks?: string[]; fields?: string[]; limit?: number; cursor?: string | null; format?: 'json' | 'csv'; all?: boolean }
) {
	requireScope(actor, 'read');
	const notes = actor.scopes.has('notes');
	const { from, to } = rangeOf(actor, input, 90);
	const habits = visibleHabits(actor, { archived: true });
	const wanted = input.habits?.length ? new Set(input.habits.map((r) => findHabit(actor, r).id)) : null;
	const hs = habits.filter((h) => !wanted || wanted.has(h.id));
	const hById = new Map(hs.map((h) => [h.id, h]));
	const occs = hs.length
		? db
				.select()
				.from(occurrence)
				.innerJoin(habit, eq(occurrence.habitId, habit.id))
				.where(and(eq(habit.accountId, actor.accountId), gte(occurrence.date, from), lte(occurrence.date, to)))
				.orderBy(asc(occurrence.date))
				.all()
				.map((r) => r.occurrence)
				.filter((o) => hById.has(o.habitId))
		: [];
	const occById = new Map(occs.map((o) => [o.id, o]));
	const entries = occs.length
		? db
				.select({ e: entry })
				.from(entry)
				.innerJoin(occurrence, eq(entry.occurrenceId, occurrence.id))
				.innerJoin(habit, eq(occurrence.habitId, habit.id))
				.where(and(eq(habit.accountId, actor.accountId), gte(occurrence.date, from), lte(occurrence.date, to)))
				.orderBy(asc(entry.sortOrder))
				.all()
				.map((r) => r.e)
				.filter((e) => occById.has(e.occurrenceId))
		: [];
	const tasks = new Map(db.select().from(task).where(eq(task.accountId, actor.accountId)).all().map((t) => [t.id, t]));
	const metrics = new Map(
		db.select({ m: metric }).from(metric).innerJoin(task, eq(metric.taskId, task.id)).where(eq(task.accountId, actor.accountId)).all().map((r) => [r.m.id, r.m])
	);
	const variants = new Map(
		hs.length ? db.select().from(variant).where(inArray(variant.habitId, hs.map((h) => h.id))).all().map((v) => [v.id, v.name]) : []
	);
	const parts = new Map(
		db
			.select({ p: taskPart })
			.from(taskPart)
			.innerJoin(task, eq(taskPart.taskId, task.id))
			.where(eq(task.accountId, actor.accountId))
			.all()
			.map((r) => [r.p.id, r.p])
	);
	/** Where an Entry sits, in words, and its round: "Circuit › Push-ups", 2. */
	const placeOf = (e: { taskId: string; path: string | null }): { name: string; round: number | null; inside: string[] } => {
		const t = tasks.get(e.taskId);
		const segs = e.path ? parsePath(e.path) : [];
		const round = segs.find((x) => x.round)?.round ?? null;
		const chain = segs.slice(1).map((x) => parts.get(x.id));
		if (chain.length && chain.every(Boolean)) {
			const ids = [chain[0]!.taskId, ...chain.map((p) => p!.childTaskId)];
			return { name: ids.map((id) => tasks.get(id)?.name ?? '').join(' › '), round, inside: ids.slice(0, -1) };
		}
		// A step ticked before paths: under the Task it belongs to.
		if (t?.parentTaskId) return { name: `${tasks.get(t.parentTaskId)?.name ?? ''} › ${t.name}`, round, inside: [t.parentTaskId] };
		return { name: t?.name ?? '', round, inside: [] };
	};
	const matchTask = input.tasks?.length ? input.tasks.map((t) => t.toLowerCase()) : null;
	const matchField = input.fields?.length ? input.fields.map((f) => f.toLowerCase()) : null;
	const taskOk = (id: string, name: string) => !matchTask || matchTask.includes(id.toLowerCase()) || matchTask.includes(name.toLowerCase());
	const fieldOk = (id: string, name: string) => !matchField || matchField.includes(id.toLowerCase()) || matchField.includes(name.toLowerCase());

	const rows: ValueRow[] = [];
	const setNo = new Map<string, number>();
	for (const e of entries) {
		const o = occById.get(e.occurrenceId)!;
		const h = hById.get(o.habitId)!;
		const t = tasks.get(e.taskId);
		if (!t) continue;
		const values = e.values as Values;
		const base = {
			ref: `log:${o.id}`,
			date: o.date,
			weekday: WEEKDAYS[weekday(o.date)],
			habitId: h.id,
			habit: h.name,
			status: o.status,
			variant: o.variantId ? (variants.get(o.variantId) ?? null) : null,
			level: o.level ?? (o.status === 'done' ? 'target' : null)
		};
		const at = placeOf(e);
		// A Task asked for by name also brings what is logged inside it.
		const asked = taskOk(t.id, t.name) || at.inside.some((id) => taskOk(id, tasks.get(id)?.name ?? ''));
		// A ticked step, or a plain Yes or no Task.
		if (values.done === true && Object.keys(values).length === 1) {
			if (asked && fieldOk('done', 'done'))
				rows.push({ ...base, taskId: t.id, task: at.name, set: null, round: at.round, fieldId: 'done', field: 'Done', type: 'tick', unit: null, value: true, score: null });
			continue;
		}
		if (!asked) continue;
		const isSet = !values._summary;
		let n: number | null = null;
		if (isSet) {
			const k = `${o.id}|${e.path ?? t.id}`;
			n = (setNo.get(k) ?? 0) + 1;
			setNo.set(k, n);
		}
		for (const [k, v] of Object.entries(values)) {
			if (k === '_summary') continue;
			const m = metrics.get(k);
			if (!m || v === null || v === undefined || v === '') continue;
			if (m.type === 'text' && !notes) continue;
			if (!fieldOk(m.id, m.name)) continue;
			if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean') continue;
			rows.push({
				...base,
				taskId: t.id,
				task: at.name,
				set: isSet ? n : null,
				round: at.round,
				fieldId: m.id,
				field: m.name,
				type: m.type,
				unit: metricUnit(m),
				// A Choice stores its option's id: the row shows the option's name and number.
				value: m.type === 'choice' ? (optionName(m.choices, v) ?? v) : v,
				score: m.type === 'choice' && typeof v === 'string' ? (scoresOn(m.scores, m.earlierScores, o.date)[v] ?? null) : null
			});
		}
	}
	const out = page(rows, input, { from, to }, 5000);
	if (input.format === 'csv') {
		const cols: (keyof ValueRow)[] = ['ref', 'date', 'weekday', 'habit', 'status', 'variant', 'level', 'task', 'set', 'round', 'field', 'type', 'unit', 'value', 'score'];
		const cell = (v: unknown) => {
			const s = v === null || v === undefined ? '' : String(v);
			return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
		};
		const csv = [cols.join(','), ...out.rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
		return { from, to, total: out.total, returned: out.returned, next: out.next, columns: cols, csv };
	}
	return out;
}

// ---------- one record ----------

/** Open a ref from any answer: log:<id>, slip:<id>, habit:<id>, task:<id> or day:<YYYY-MM-DD>. */
export function getRecord(actor: Actor, input: { ref: string }) {
	requireScope(actor, 'read');
	const notes = actor.scopes.has('notes');
	const m = input.ref.trim().match(/^(log|slip|habit|task|day):(.+)$/);
	if (!m) throw new ActionError('invalid', 'A ref looks like log:<id>, slip:<id>, habit:<id>, task:<id> or day:YYYY-MM-DD.');
	const [, kind, id] = m;
	if (kind === 'habit') {
		const h = findHabit(actor, id);
		return { ref: `habit:${h.id}`, ...describe(actor).habits.find((x) => x.id === h.id), notes: notes ? h.notes : undefined };
	}
	if (kind === 'task') {
		const t = describe(actor).tasks.find((x) => x.id === id);
		if (!t) throw new ActionError('not_found', 'No such Task.');
		const row = notes ? db.select({ notes: task.notes }).from(task).where(eq(task.id, id)).get() : null;
		return { ...t, notes: row?.notes ?? undefined };
	}
	if (kind === 'slip') {
		const r = db.select({ s: slip, name: habit.name, triggers: habit.triggers }).from(slip).innerJoin(habit, eq(slip.habitId, habit.id)).where(and(eq(slip.id, id), eq(habit.accountId, actor.accountId))).get();
		if (!r || !canSeeHabit(actor, r.s.habitId)) throw new ActionError('not_found', 'No such slip.');
		return { ref: `slip:${r.s.id}`, habit: r.name, habitId: r.s.habitId, date: r.s.date, count: r.s.count, time: r.s.time, place: r.s.place, feeling: optionName(r.triggers, r.s.feeling), withWhom: r.s.withWhom, notes: notes ? r.s.notes : undefined };
	}
	if (kind === 'day') {
		const date = dayOf(actor, id).date;
		const logs = listLogs(actor, { from: date, to: date, limit: 500 }).rows;
		const note = notes && !actor.habitIds ? db.select({ text: dayNote.text }).from(dayNote).where(and(eq(dayNote.accountId, actor.accountId), eq(dayNote.date, date))).get() : null;
		return { ref: `day:${date}`, date, weekday: WEEKDAYS[weekday(date)], logs, dayNote: note?.text ?? undefined };
	}
	const o = db.select({ occ: occurrence, name: habit.name }).from(occurrence).innerJoin(habit, eq(occurrence.habitId, habit.id)).where(and(eq(occurrence.id, id), eq(habit.accountId, actor.accountId))).get();
	if (!o || !canSeeHabit(actor, o.occ.habitId)) throw new ActionError('not_found', 'No such log.');
	const values = listValues(actor, { from: o.occ.date, to: o.occ.date, habits: [o.occ.habitId], limit: 5000 }) as { rows: ValueRow[] };
	const p = progressForIds([o.occ.id]).get(o.occ.id);
	return {
		ref: `log:${o.occ.id}`,
		habit: o.name,
		habitId: o.occ.habitId,
		date: o.occ.date,
		weekday: WEEKDAYS[weekday(o.occ.date)],
		status: o.occ.status,
		level: o.occ.level ?? (o.occ.status === 'done' ? 'target' : null),
		extra: o.occ.extra,
		finishedAt: o.occ.finishedAt?.toISOString() ?? null,
		progress: p ? progressText(p) : null,
		values: values.rows.filter((r) => r.ref === `log:${o.occ.id}`).map(({ task: t, set, field, value, unit, score }) => ({ task: t, set, field, value, unit, score })),
		notes: notes ? o.occ.notes : undefined
	};
}

// ---------- today ----------

/** Today's plan: each build habit's state and progress, and each break habit's run. */
export function today(actor: Actor) {
	requireScope(actor, 'read');
	const date = userToday(actor.accountId, actor.tz);
	// As opening Today does: create today's logs for habits due today.
	// Groups last: one of them counts every group's day from the habits inside.
	const build = visibleHabits(actor).filter((h) => h.direction === 'build' && h.schedule);
	for (const h of build) if (!isGroup(h.schedule as Schedule)) ensureToday(actor.accountId, h.id, h.schedule as ScheduleForm, date);
	const group = build.find((h) => isGroup(h.schedule as Schedule));
	if (group) ensureToday(actor.accountId, group.id, group.schedule as ScheduleForm, date);
	// ensureToday counts parents again for habits in a tree; a group alone does it for all.
	return dayView(actor, date);
}

export function dayView(actor: Actor, date: string) {
	const P = preparedFor(actor);
	const rows = listLogs(actor, { from: date, to: date, limit: 500 }).rows;
	const breakHabits = P.ds.habits.filter((h) => h.direction === 'break' && !h.archived);
	return {
		date,
		weekday: WEEKDAYS[weekday(date)],
		build: rows.filter((r) => r.kind === 'log'),
		break: breakHabits.map((h) => {
			const slips = P.ds.slips.filter((s) => s.habitId === h.id);
			const last = slips.map((s) => s.date).sort().at(-1) ?? null;
			const since = last ?? h.startDate;
			return {
				habitId: h.id,
				habit: h.name,
				slipsToday: slips.filter((s) => s.date === date).reduce((a, s) => a + s.count, 0),
				lastSlip: last,
				daysSince: Math.max(0, Math.round((Date.parse(date) - Date.parse(since)) / 86_400_000))
			};
		}),
		resting: P.ds.habits
			.filter((h) => h.direction === 'build' && !h.archived && !rows.some((r) => r.habitId === h.id))
			.map((h) => ({ habitId: h.id, habit: h.name }))
	};
}

// ---------- habit summary ----------

/** Per habit over a range: done, missed, skipped, the rate, the streak now and the longest run; slips for break habits. */
export function habitSummary(actor: Actor, input: { from?: string | null; to?: string | null; days?: number | null; habits?: string[] }) {
	requireScope(actor, 'read');
	const { from, to, today } = rangeOf(actor, input);
	const P = preparedFor(actor);
	const wanted = input.habits?.length ? new Set(input.habits.map((r) => findHabit(actor, r).id)) : null;
	return {
		from,
		to,
		habits: P.ds.habits
			.filter((h) => (!wanted || wanted.has(h.id)) && (!h.archived || wanted))
			.map((h) => {
				if (h.direction === 'break') {
					const slips = P.ds.slips.filter((s) => s.habitId === h.id);
					const inR = slips.filter((s) => s.date >= from && s.date <= to);
					const days = new Set(inR.map((s) => s.date));
					const span = Math.max(0, Math.round((Date.parse(to) - Date.parse(from > h.startDate ? from : h.startDate)) / 86_400_000) + 1);
					return {
						ref: `habit:${h.id}`,
						habit: h.name,
						direction: 'break',
						slips: inR.reduce((a, s) => a + s.count, 0),
						daysWithSlips: days.size,
						cleanDays: Math.max(0, span - days.size),
						cravingsResisted: P.ds.cravings.filter((c) => c.habitId === h.id && c.date >= from && c.date <= to).length
					};
				}
				const occs = P.occsByHabit.get(h.id) ?? [];
				const inR = occs.filter((o) => o.date >= from && o.date <= to);
				const n = (s: string) => inR.filter((o) => o.status === s).length;
				const done = n('done');
				const missed = n('missed');
				let run = 0;
				let best = 0;
				for (const o of occs) {
					if (o.status === 'done') best = Math.max(best, ++run);
					else if (o.status === 'missed') run = 0;
				}
				const st = streak(occs, h.streakRule as StreakRule, { minimumCounts: h.minimumCounts, today });
				const lastDone = [...occs].reverse().find((o) => o.status === 'done')?.date ?? null;
				const weekdays = WEEKDAYS.map((w, i) => {
					const day = inR.filter((o) => weekday(o.date) === i && (o.status === 'done' || o.status === 'missed'));
					return { weekday: w, done: day.filter((o) => o.status === 'done').length, missed: day.filter((o) => o.status === 'missed').length };
				}).filter((w) => w.done || w.missed);
				return {
					ref: `habit:${h.id}`,
					habit: h.name,
					direction: 'build',
					done,
					missed,
					skipped: n('skipped'),
					stillDue: n('due'),
					rate: done + missed ? Math.round((done / (done + missed)) * 1000) / 10 : null,
					rateMeans: 'done ÷ (done + missed), in %; skipped days count neither way',
					streakNow: { value: st.value, unit: st.unit, atRisk: st.atRisk, rule: (h.streakRule as StreakRule).kind },
					longestRunEver: best,
					lastDone,
					byWeekday: weekdays
				};
			})
	};
}

// ---------- notes ----------

/** Search notes, journal entries and text fields. Needs the notes scope. */
export function searchNotes(actor: Actor, input: { query?: string | null; from?: string | null; to?: string | null; days?: number | null; limit?: number; cursor?: string | null }) {
	requireScope(actor, 'read');
	requireScope(actor, 'notes');
	const { from, to } = rangeOf(actor, input, 3650);
	const q = (input.query ?? '').trim().toLowerCase();
	const hits: { ref: string; date: string; habit: string | null; kind: string; title: string; text: string }[] = [];
	const push = (h: (typeof hits)[number]) => {
		if (!q || h.text.toLowerCase().includes(q) || h.title.toLowerCase().includes(q)) hits.push(h);
	};
	const habits = new Map(visibleHabits(actor, { archived: true }).map((h) => [h.id, h.name]));
	if (!actor.habitIds)
		for (const n of db.select().from(dayNote).where(and(eq(dayNote.accountId, actor.accountId), gte(dayNote.date, from), lte(dayNote.date, to))).all())
			push({ ref: `day:${n.date}`, date: n.date, habit: null, kind: 'day note', title: 'Day note', text: n.text });
	const occRows = db
		.select({ id: occurrence.id, date: occurrence.date, notes: occurrence.notes, habitId: occurrence.habitId })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(and(eq(habit.accountId, actor.accountId), gte(occurrence.date, from), lte(occurrence.date, to)))
		.all()
		.filter((o) => habits.has(o.habitId));
	for (const o of occRows) if (o.notes?.trim()) push({ ref: `log:${o.id}`, date: o.date, habit: habits.get(o.habitId)!, kind: 'log note', title: `${habits.get(o.habitId)} · Notes`, text: o.notes });
	const texts = listValues(actor, { from, to, limit: 5000 }) as { rows: ValueRow[] };
	for (const r of texts.rows) if (r.type === 'text' && typeof r.value === 'string') push({ ref: r.ref, date: r.date, habit: r.habit, kind: 'text field', title: `${r.habit} · ${r.field}`, text: r.value });
	for (const { s } of db.select({ s: slip }).from(slip).innerJoin(habit, eq(slip.habitId, habit.id)).where(and(eq(habit.accountId, actor.accountId), gte(slip.date, from), lte(slip.date, to))).all())
		if (s.notes?.trim() && habits.has(s.habitId)) push({ ref: `slip:${s.id}`, date: s.date, habit: habits.get(s.habitId)!, kind: 'slip note', title: `${habits.get(s.habitId)} · Slip`, text: s.notes });
	hits.sort((a, b) => b.date.localeCompare(a.date));
	const out = page(hits, input, { from, to, query: q || null }, 500);
	// Long entries come as an excerpt around the match; get_record has the whole text.
	return { ...out, rows: out.rows.map((h) => ({ ...h, text: h.text.length > 1200 ? excerpt(h.text, 1200) : h.text })) };
}

export { listEvents };
