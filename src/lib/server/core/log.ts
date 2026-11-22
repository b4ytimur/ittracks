// Writing logs: done, skipped, undone, a value, a Task's sets, slips, cravings and notes.
// Today, the Day page, reminder buttons, quick-log links, keys and the MCP server all call
// these, so the rules (one-tap targets, "Same as last time", required fields, the past-day
// window) live in one place, and every change lands in the event log.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { craving, entry, habit, metric, occurrence, slip, slot, task } from '../db/schema';
import { missingRequired, quickDone, reopen, sameAsLast, timeIn, userToday } from '../today';
import { clearDay } from '../backfill';
import { getSettings } from '../settings';
import { getDayNote, saveDayNote } from '../journal';
import { finishAs, plusOne, progressForIds } from '../progress';
import { progressText } from '$lib/engine/progress';
import { NOTE_MAX } from '$lib/forms';
import type { Level } from '$lib/engine/streak';
import { ActionError, canSeeHabit, requireScope, type Actor } from './actor';
import { emit } from './events';
import { buildDay, change, dayOf, findHabit, occurrenceFor, type Day, type HabitRow, type OccRow } from './day';

export type DoneHow = 'auto' | 'targets' | 'same' | 'mark';
type Values = Record<string, unknown>;

export interface LogResult {
	habitId: string;
	habit: string;
	date: string;
	occurrenceId: string;
	status: 'due' | 'done' | 'skipped' | 'missed';
	level: Level | null;
	/** "3 of 6 glasses", "2 of 4 steps", or null. */
	progress: string | null;
	/** Required fields still empty: the log stays due until they are filled in. */
	missing?: string[];
	/** Nothing changed: it already was in that state. */
	already?: boolean;
}

/** Where an Occurrence stands now, as actions report it. */
export function resultOf(occurrenceId: string, extra: Partial<LogResult> = {}): LogResult {
	const o = db
		.select({ occ: occurrence, habit: { id: habit.id, name: habit.name } })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(eq(occurrence.id, occurrenceId))
		.get();
	if (!o) throw new ActionError('not_found', 'That log is gone.');
	const p = progressForIds([o.occ.id]).get(o.occ.id);
	return {
		habitId: o.habit.id,
		habit: o.habit.name,
		date: o.occ.date,
		occurrenceId: o.occ.id,
		status: o.occ.status,
		level: o.occ.level ?? null,
		progress: p ? progressText(p) : null,
		...extra
	};
}

const hasSlots = (occ: Pick<OccRow, 'variantId'>) =>
	!!(occ.variantId && db.select({ id: slot.id }).from(slot).where(eq(slot.variantId, occ.variantId)).get());

// ---------- one Occurrence (the app's buttons call these directly) ----------

/**
 * Done. `targets` logs the Slot targets at a level (one tap), `same` copies the last log,
 * `mark` keeps whatever is logged, and `auto` picks as a quick-log link does: the last log
 * when the habit has Tasks, else a plain done.
 */
export function doneOcc(actor: Actor, occ: OccRow, how: DoneHow, level: Level | null): 'done' | 'needsInput' | 'gone' {
	let r: 'done' | 'needsInput' | 'gone';
	if (how === 'mark') {
		db.update(occurrence)
			.set({ status: 'done', finishedAt: new Date(), level: level === 'target' ? null : level })
			.where(eq(occurrence.id, occ.id))
			.run();
		r = 'done';
	} else if (how === 'targets') r = quickDone(occ.id, level);
	else if (how === 'same') r = sameAsLast(occ.id);
	else r = hasSlots(occ) ? sameAsLast(occ.id) : quickDone(occ.id, level);
	// A log that falls short of the habit's rule stays open today (missed on a past day).
	if (r === 'done' && finishAs(occ.id, userToday(actor.accountId, actor.tz)) !== 'done') return 'done';
	if (r === 'done') {
		const now = db.select({ level: occurrence.level }).from(occurrence).where(eq(occurrence.id, occ.id)).get();
		emit(actor, 'occurrence.done', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, level: now?.level ?? null, how } });
	}
	return r;
}

export function skipOcc(actor: Actor, occ: OccRow) {
	db.update(occurrence).set({ status: 'skipped', finishedAt: null, level: null }).where(eq(occurrence.id, occ.id)).run();
	emit(actor, 'occurrence.skipped', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id } });
}

/** Back to due; `clear` also removes what was logged (undoing a one-tap log). */
export function reopenOcc(actor: Actor, occ: OccRow, clear: boolean) {
	reopen(occ.id, clear);
	emit(actor, 'occurrence.reopened', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, cleared: clear } });
}

/** A past day's log taken away: back to missed if it was due, else gone. */
export function clearOcc(actor: Actor, day: Pick<Day, 'habit' | 'schedule' | 'date' | 'today'>) {
	const occ = db.select().from(occurrence).where(and(eq(occurrence.habitId, day.habit.id), eq(occurrence.date, day.date))).get();
	clearDay(actor.accountId, day.habit.id, day.schedule, day.date, day.today);
	if (occ) emit(actor, 'occurrence.cleared', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id } });
}

/** +1 (or −1) toward a habit's one target, from Today. Reaching the target finishes it. */
export function plusOcc(actor: Actor, occ: OccRow, by: 1 | -1) {
	const r = plusOne(occ.id, by);
	if (!r) return null;
	emit(actor, 'value.logged', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, value: by, total: r.value, how: 'plus' } });
	if (r.done && by > 0 && occ.status !== 'done')
		emit(actor, 'occurrence.done', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, level: occ.level ?? null, how: 'plus' } });
	if (!r.done && by < 0 && occ.status === 'done')
		emit(actor, 'occurrence.reopened', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, cleared: false } });
	return r;
}

// ---------- by habit and day (keys, links, the MCP server) ----------

function act(day: Day, actor: Actor, opts: { extra?: boolean; variant?: string | null }) {
	return occurrenceFor(actor, day, opts);
}

export function logDone(
	actor: Actor,
	input: { habit: string; date?: string | null; how?: DoneHow; level?: Level | null; extra?: boolean; variant?: string | null }
): LogResult {
	requireScope(actor, 'log');
	const day = buildDay(actor, input.habit, input.date);
	return change(actor, day, () => {
		const occ = act(day, actor, input);
		if (occ.status === 'done') return resultOf(occ.id, { already: true });
		const r = doneOcc(actor, occ, input.how ?? 'auto', input.level ?? null);
		if (r === 'gone') throw new ActionError('not_found', `${day.habit.name} has nothing to log.`);
		return resultOf(occ.id, r === 'needsInput' ? { missing: missingRequired(occ.id) } : {});
	});
}

export function logSkip(actor: Actor, input: { habit: string; date?: string | null; extra?: boolean }): LogResult {
	requireScope(actor, 'log');
	const day = buildDay(actor, input.habit, input.date);
	return change(actor, day, () => {
		const occ = act(day, actor, input);
		if (occ.status === 'skipped') return resultOf(occ.id, { already: true });
		skipOcc(actor, occ);
		return resultOf(occ.id);
	});
}

export function logUndo(actor: Actor, input: { habit: string; date?: string | null; clear?: boolean }): LogResult | { habit: string; date: string; status: 'none' } {
	requireScope(actor, 'log');
	const day = buildDay(actor, input.habit, input.date);
	const occ = db.select().from(occurrence).where(and(eq(occurrence.habitId, day.habit.id), eq(occurrence.date, day.date))).get();
	if (!occ) return { habit: day.habit.name, date: day.date, status: 'none' };
	return change(actor, day, () => {
		if (day.past && input.clear) {
			clearOcc(actor, day);
			const still = db.select({ id: occurrence.id }).from(occurrence).where(eq(occurrence.id, occ.id)).get();
			return still ? resultOf(occ.id) : { habit: day.habit.name, date: day.date, status: 'none' as const };
		}
		if (occ.status === 'due' && !input.clear) return resultOf(occ.id, { already: true });
		reopenOcc(actor, occ, !!input.clear);
		return resultOf(occ.id);
	});
}

// ---------- fields ----------

interface TaskInLog {
	taskId: string;
	name: string;
	metrics: (typeof metric.$inferSelect)[];
	subtasks: { id: string; name: string }[];
	/** Targets at the log's level, falling back to Target. */
	targets: Record<string, number>;
}

/** The Tasks a day's log holds, in Slot order, with the Task auto-filled Slots picked that day. */
function tasksOf(occ: OccRow): TaskInLog[] {
	if (!occ.variantId) return [];
	const slots = db.select().from(slot).where(eq(slot.variantId, occ.variantId)).orderBy(asc(slot.sortOrder)).all();
	const out: TaskInLog[] = [];
	for (const s of slots) {
		const taskId = occ.picks?.[s.id] ?? s.taskId;
		if (!taskId || out.some((t) => t.taskId === taskId)) continue;
		const t = db.select({ name: task.name }).from(task).where(eq(task.id, taskId)).get();
		if (!t) continue;
		out.push({
			taskId,
			name: t.name,
			metrics: db.select().from(metric).where(and(eq(metric.taskId, taskId), eq(metric.archived, false))).orderBy(asc(metric.sortOrder)).all(),
			subtasks: db
				.select({ id: task.id, name: task.name, archived: task.archived })
				.from(task)
				.where(eq(task.parentTaskId, taskId))
				.orderBy(asc(task.sortOrder))
				.all()
				.filter((x) => !x.archived),
			targets: {
				...(s.targets ?? {}),
				...((occ.level === 'minimum' ? s.minTargets : occ.level === 'stretch' ? s.stretchTargets : null) ?? {})
			}
		});
	}
	return out;
}

const norm = (s: string) => s.trim().toLowerCase();
const byRef = <T extends { id: string; name: string }>(xs: T[], ref: string): T | undefined =>
	xs.find((x) => x.id === ref) ?? xs.find((x) => norm(x.name) === norm(ref));

const numeric = (type: string) => type === 'number' || type === 'count' || type === 'duration';

/** A value checked against its field's type: numbers, Yes or no, one of the options, or text. */
function checkValue(actor: Actor, m: typeof metric.$inferSelect, v: unknown): unknown {
	if (v === null) return null;
	if (numeric(m.type)) {
		const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
		if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new ActionError('invalid', `${m.name} takes a number.`);
		return n;
	}
	if (m.type === 'checkbox') {
		if (typeof v === 'boolean') return v;
		if (v === 1 || v === 'true' || v === 'yes' || v === '1') return true;
		if (v === 0 || v === 'false' || v === 'no' || v === '0') return false;
		throw new ActionError('invalid', `${m.name} takes true or false.`);
	}
	if (m.type === 'choice') {
		const c = (m.choices ?? []).find((x) => norm(x) === norm(String(v)));
		if (!c) throw new ActionError('invalid', `${m.name} is one of: ${(m.choices ?? []).join(', ')}.`);
		return c;
	}
	// Text fields can hold journal entries: private, like notes.
	requireScope(actor, 'notes');
	if (typeof v !== 'string') throw new ActionError('invalid', `${m.name} takes text.`);
	return v.slice(0, NOTE_MAX);
}

function fieldList(tasks: TaskInLog[], repeats: boolean) {
	return tasks.flatMap((t) => t.metrics.filter((m) => m.repeats === repeats).map((m) => `${t.name}: ${m.name}${m.unit ? ` (${m.unit})` : ''}`));
}

/** Finish when it reached its target, or every step is done; a one-step log is done once something is in it. */
function reached(occId: string): boolean {
	const p = progressForIds([occId]).get(occId);
	if (!p) return true;
	return p.kind === 'amount' ? p.value >= p.target : p.done >= p.total;
}

function finishIf(actor: Actor, occ: OccRow, finish: 'auto' | 'yes' | 'no', how: string) {
	const now = db.select({ status: occurrence.status }).from(occurrence).where(eq(occurrence.id, occ.id)).get();
	if (!now || now.status === 'done' || finish === 'no') return;
	if (finish === 'yes' || reached(occ.id)) {
		db.update(occurrence).set({ status: 'done', finishedAt: new Date() }).where(eq(occurrence.id, occ.id)).run();
		if (finishAs(occ.id, userToday(actor.accountId, actor.tz)) !== 'done') return;
		emit(actor, 'occurrence.done', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, level: occ.level ?? null, how } });
	}
}

/**
 * Log one value: "add 250 ml of water", "20 minutes of Spanish", "mood: Good". Numbers are
 * added to what is logged so far unless `mode` is set. With no field named, it is the
 * habit's one number with a target (as +1 on Today uses), or its only number.
 */
export function logValue(
	actor: Actor,
	input: {
		habit: string;
		date?: string | null;
		value: number | string | boolean;
		field?: string | null;
		task?: string | null;
		mode?: 'add' | 'set';
		finish?: 'auto' | 'yes' | 'no';
		extra?: boolean;
	}
): LogResult & { field: string; value: unknown; target: number | null } {
	requireScope(actor, 'log');
	const day = buildDay(actor, input.habit, input.date);
	return change(actor, day, () => {
		const occ = act(day, actor, input);
		let tasks = tasksOf(occ);
		if (input.task) {
			const t = byRef(tasks.map((x) => ({ ...x, id: x.taskId })), input.task);
			if (!t) throw new ActionError('not_found', `${day.habit.name} has no Task called “${input.task}” on ${day.date}.`);
			tasks = [t];
		}
		const single = tasks.flatMap((t) => t.metrics.filter((m) => !m.repeats).map((m) => ({ t, m })));
		let pick: { t: TaskInLog; m: typeof metric.$inferSelect } | undefined;
		if (input.field) {
			pick = single.find((x) => x.m.id === input.field) ?? single.find((x) => norm(x.m.name) === norm(input.field!));
			if (!pick) {
				const perSet = tasks.flatMap((t) => t.metrics.filter((m) => m.repeats && (m.id === input.field || norm(m.name) === norm(input.field!))));
				if (perSet.length) throw new ActionError('invalid', `${perSet[0].name} is logged per set: use log_task with sets.`);
				throw new ActionError('not_found', `No field called “${input.field}”. Fields: ${fieldList(tasks, false).join(', ') || 'none'}.`);
			}
		} else {
			const nums = single.filter((x) => numeric(x.m.type));
			const withTarget = nums.filter((x) => (x.t.targets[x.m.id] ?? 0) > 0);
			pick = withTarget.length === 1 ? withTarget[0] : nums.length === 1 ? nums[0] : undefined;
			if (!pick)
				throw new ActionError('invalid', `Say which field to log. Fields: ${fieldList(tasks, false).join(', ') || 'none (this habit has nothing to fill in: use log_done)'}.`);
		}
		const { t, m } = pick;
		const given = checkValue(actor, m, input.value);
		let value = given;
		const mine = db.select().from(entry).where(eq(entry.occurrenceId, occ.id)).orderBy(asc(entry.sortOrder)).all();
		const summary = mine.find((e) => e.taskId === t.taskId && (e.values as Values)._summary);
		const before = summary ? (summary.values as Values)[m.id] : undefined;
		if (numeric(m.type) && (input.mode ?? 'add') === 'add' && typeof before === 'number')
			value = Math.round((before + (value as number)) * 1000) / 1000;
		db.transaction((tx) => {
			if (summary) tx.update(entry).set({ values: { ...(summary.values as Values), [m.id]: value } }).where(eq(entry.id, summary.id)).run();
			else
				tx.insert(entry)
					.values({ id: randomUUID(), occurrenceId: occ.id, taskId: t.taskId, values: { [m.id]: value, _summary: true }, sortOrder: mine.length })
					.run();
		});
		emit(actor, 'value.logged', {
			habitId: occ.habitId,
			date: occ.date,
			data: { occurrenceId: occ.id, taskId: t.taskId, metricId: m.id, value: m.type === 'text' ? null : given, total: m.type === 'text' ? null : value }
		});
		finishIf(actor, occ, input.finish ?? 'auto', 'value');
		const target = t.targets[m.id] ?? null;
		return { ...resultOf(occ.id), field: `${t.name}: ${m.name}`, value: m.type === 'text' ? '(saved)' : value, target };
	});
}

/**
 * Log a Task in a day's log: its sets ("3 × 8 at 80 kg"), its once-per-log values and its
 * sub-task ticks. Replaces what was logged for that Task unless `replace` is false, which adds
 * the sets after the ones already there. Fields are named by id or name.
 */
export function logTask(
	actor: Actor,
	input: {
		habit: string;
		date?: string | null;
		task: string;
		sets?: Values[];
		values?: Values;
		ticks?: string[];
		replace?: boolean;
		finish?: 'auto' | 'yes' | 'no';
		extra?: boolean;
	}
): LogResult & { task: string; sets: number } {
	requireScope(actor, 'log');
	const day = buildDay(actor, input.habit, input.date);
	return change(actor, day, () => {
		const occ = act(day, actor, input);
		const tasks = tasksOf(occ);
		const t = byRef(tasks.map((x) => ({ ...x, id: x.taskId })), input.task);
		if (!t)
			throw new ActionError('not_found', `${day.habit.name} has no Task called “${input.task}” on ${day.date}. Tasks: ${tasks.map((x) => x.name).join(', ') || 'none'}.`);
		const fieldOf = (k: string, repeats: boolean) => {
			const m = t.metrics.find((x) => x.id === k) ?? t.metrics.find((x) => norm(x.name) === norm(k));
			if (!m) throw new ActionError('not_found', `${t.name} has no field “${k}”. Fields: ${t.metrics.map((x) => x.name).join(', ') || 'none'}.`);
			if (m.repeats !== repeats)
				throw new ActionError('invalid', repeats ? `${m.name} is logged once, not per set: put it in values.` : `${m.name} is logged per set: put it in sets.`);
			return m;
		};
		const toValues = (raw: Values, repeats: boolean): Values =>
			Object.fromEntries(Object.entries(raw).map(([k, v]) => {
				const m = fieldOf(k, repeats);
				return [m.id, checkValue(actor, m, v)];
			}));
		const sets = (input.sets ?? []).slice(0, 100).map((s) => toValues(s, true)).filter((s) => Object.keys(s).length);
		const single = toValues(input.values ?? {}, false);
		const ticks = (input.ticks ?? []).map((ref) => {
			const s = byRef(t.subtasks, ref);
			if (!s) throw new ActionError('not_found', `${t.name} has no step called “${ref}”. Steps: ${t.subtasks.map((x) => x.name).join(', ') || 'none'}.`);
			return s.id;
		});
		// A plain Yes or no Task (no fields, no steps) is ticked by logging it at all.
		const yesNo = !t.metrics.length && !t.subtasks.length;
		if (!sets.length && !Object.keys(single).length && !ticks.length && !yesNo)
			throw new ActionError('invalid', `Send sets, values or ticks for ${t.name}.`);

		const all = db.select().from(entry).where(eq(entry.occurrenceId, occ.id)).orderBy(asc(entry.sortOrder)).all();
		// This Task's first Slot: its sets, then its once-per-log values, which close the group.
		const group: typeof all = [];
		for (const e of all) {
			if (e.taskId !== t.taskId) continue;
			group.push(e);
			if ((e.values as Values)._summary) break;
		}
		const oldSets = group.filter((e) => !(e.values as Values)._summary).map((e) => e.values as Values);
		const oldSingle = (group.find((e) => (e.values as Values)._summary)?.values ?? {}) as Values;
		const replace = input.replace ?? true;
		const nextSets = replace ? sets : [...oldSets, ...sets];
		const keptSingle = Object.fromEntries(Object.entries(oldSingle).filter(([k]) => k !== '_summary'));
		const nextSingle = replace && Object.keys(single).length ? single : { ...keptSingle, ...single };
		const newGroup: Values[] = [...nextSets, ...(Object.keys(nextSingle).length ? [{ ...nextSingle, _summary: true }] : [])];
		if (yesNo) newGroup.splice(0, newGroup.length, { done: true });
		const subIds = new Set(t.subtasks.map((s) => s.id));
		const ticked = new Set(all.filter((e) => subIds.has(e.taskId)).map((e) => e.taskId));
		const at = group.length ? all.indexOf(group[0]) : all.length;
		const rest = all.filter((e) => !group.includes(e));
		const order: ({ id: string } | { taskId: string; values: Values })[] = [
			...rest.slice(0, at),
			...newGroup.map((values) => ({ taskId: t.taskId, values })),
			...ticks.filter((id) => !ticked.has(id)).map((id) => ({ taskId: id, values: { done: true } })),
			...rest.slice(at)
		];
		db.transaction((tx) => {
			if (group.length) tx.delete(entry).where(inArray(entry.id, group.map((e) => e.id))).run();
			order.forEach((e, i) => {
				if ('id' in e) tx.update(entry).set({ sortOrder: i }).where(eq(entry.id, e.id)).run();
				else tx.insert(entry).values({ id: randomUUID(), occurrenceId: occ.id, taskId: e.taskId, values: e.values, sortOrder: i }).run();
			});
		});
		emit(actor, 'sets.logged', {
			habitId: occ.habitId,
			date: occ.date,
			data: { occurrenceId: occ.id, taskId: t.taskId, sets: nextSets.length, replaced: replace, ticks: ticks.length }
		});
		finishIf(actor, occ, input.finish ?? 'auto', 'task');
		return { ...resultOf(occ.id), task: t.name, sets: nextSets.length };
	});
}

// ---------- break habits ----------

const clip = (v: string | null | undefined, n: number) => (v ?? '').trim().slice(0, n) || null;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function breakHabit(actor: Actor, ref: string): HabitRow {
	const h = findHabit(actor, ref);
	if (h.direction !== 'break') throw new ActionError('invalid', `${h.name} is a build habit: log it as done instead.`);
	return h;
}

export function addSlip(
	actor: Actor,
	input: { habit: string; date?: string | null; count?: number; time?: string | null; place?: string | null; feeling?: string | null; withWhom?: string | null; notes?: string | null },
	/** A slip today with no time is stamped with the time now; the app's forms send their own. */
	opts: { stampNow?: boolean } = {}
) {
	requireScope(actor, 'log');
	if (input.notes) requireScope(actor, 'notes');
	const h = breakHabit(actor, input.habit);
	const { date, today } = dayOf(actor, input.date);
	if (date < h.startDate) throw new ActionError('invalid', `${h.name} started on ${h.startDate}.`);
	const count = input.count ?? 1;
	if (!Number.isInteger(count) || count < 1 || count > 1000) throw new ActionError('invalid', 'Count must be a whole number from 1 to 1000.');
	const time = input.time && CLOCK.test(input.time) ? input.time : date === today && (opts.stampNow ?? true) ? timeIn(actor.tz ?? getSettings(actor.accountId).timeZone) : null;
	const id = randomUUID();
	db.insert(slip)
		.values({
			id,
			habitId: h.id,
			date,
			count,
			notes: clip(input.notes, NOTE_MAX),
			time,
			place: clip(input.place, 120),
			feeling: clip(input.feeling, 40),
			withWhom: clip(input.withWhom, 120)
		})
		.run();
	emit(actor, 'slip.logged', { habitId: h.id, date, data: { slipId: id, count } });
	const today2 = db.select({ count: slip.count }).from(slip).where(and(eq(slip.habitId, h.id), eq(slip.date, date))).all();
	return { slipId: id, habitId: h.id, habit: h.name, date, count, slipsThatDay: today2.reduce((n, s) => n + s.count, 0) };
}

/** Take a slip back. Returns the removed row, so the app can offer Undo. */
export function removeSlip(actor: Actor, slipId: string) {
	requireScope(actor, 'log');
	const row = db
		.select({ s: slip })
		.from(slip)
		.innerJoin(habit, eq(slip.habitId, habit.id))
		.where(and(eq(slip.id, slipId), eq(habit.accountId, actor.accountId)))
		.get();
	if (!row || !canSeeHabit(actor, row.s.habitId)) throw new ActionError('not_found', 'No such slip.');
	db.delete(slip).where(eq(slip.id, row.s.id)).run();
	emit(actor, 'slip.removed', { habitId: row.s.habitId, date: row.s.date, data: { slipId: row.s.id } });
	return row.s;
}

export function resistCraving(actor: Actor, input: { habit: string; date?: string | null; time?: string | null }) {
	requireScope(actor, 'log');
	const h = breakHabit(actor, input.habit);
	const { date, today } = dayOf(actor, input.date);
	const id = randomUUID();
	const time = input.time && CLOCK.test(input.time) ? input.time : date === today ? timeIn(actor.tz ?? getSettings(actor.accountId).timeZone) : null;
	db.insert(craving).values({ id, habitId: h.id, date, time }).run();
	emit(actor, 'craving.resisted', { habitId: h.id, date, data: { cravingId: id } });
	return { cravingId: id, habitId: h.id, habit: h.name, date };
}

export function removeCraving(actor: Actor, cravingId: string) {
	requireScope(actor, 'log');
	const row = db
		.select({ c: craving })
		.from(craving)
		.innerJoin(habit, eq(craving.habitId, habit.id))
		.where(and(eq(craving.id, cravingId), eq(habit.accountId, actor.accountId)))
		.get();
	if (!row || !canSeeHabit(actor, row.c.habitId)) throw new ActionError('not_found', 'No such craving.');
	db.delete(craving).where(eq(craving.id, row.c.id)).run();
	emit(actor, 'craving.removed', { habitId: row.c.habitId, date: row.c.date, data: { cravingId: row.c.id } });
}

// ---------- notes ----------

/** The day note (Settings → Journal). Notes are private: the notes scope, and every habit. */
export function writeDayNote(actor: Actor, input: { date?: string | null; text: string; append?: boolean }) {
	requireScope(actor, 'notes');
	if (actor.habitIds) throw new ActionError('forbidden', 'Day notes need a key that may see every habit.');
	const { date } = dayOf(actor, input.date);
	const old = input.append ? getDayNote(actor.accountId, date) : '';
	const text = old.trim() ? `${old.trimEnd()}\n\n${input.text}` : input.text;
	saveDayNote(actor.accountId, date, text);
	emit(actor, 'note.saved', { date, data: { kind: 'day' } });
	return { date, length: Math.min(text.length, NOTE_MAX) };
}

/** The note on a habit's log for a day. */
export function writeLogNote(actor: Actor, input: { habit: string; date?: string | null; text: string; append?: boolean; extra?: boolean }) {
	requireScope(actor, 'notes');
	requireScope(actor, 'log');
	const day = buildDay(actor, input.habit, input.date);
	const occ = occurrenceFor(actor, day, { extra: input.extra ?? true });
	const old = input.append ? (occ.notes ?? '') : '';
	const text = (old.trim() ? `${old.trimEnd()}\n\n${input.text}` : input.text).slice(0, NOTE_MAX);
	db.update(occurrence).set({ notes: text.trim() ? text : null }).where(eq(occurrence.id, occ.id)).run();
	emit(actor, 'note.saved', { habitId: occ.habitId, date: occ.date, data: { kind: 'log', occurrenceId: occ.id } });
	return resultOf(occ.id);
}

/** Today for this actor. */
export const todayFor = (actor: Actor) => userToday(actor.accountId, actor.tz);
