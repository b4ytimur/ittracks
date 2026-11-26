// Writing logs: done, skipped, undone, a value, a Task's sets, slips, cravings and notes.
// Today, the Day page, reminder buttons, quick-log links, keys and the MCP server all call
// these, so the rules (one-tap targets, "Same as last time", required fields, the past-day
// window) live in one place, and every change lands in the event log.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { craving, entry, habit, metric, occurrence, slip, slot, task } from '../db/schema';
import { missingRequired, quickDone, reopen, sameAsLast, timeIn, userToday } from '../today';
import { clearDay, kidsDueOn } from '../backfill';
import { getSettings } from '../settings';
import { getDayNote, saveDayNote } from '../journal';
import { finishAs, plusOne, progressForIds, targetsAt } from '../progress';
import { positionsOf } from '../positions';
import { place } from '$lib/engine/parts';
import { isTick } from '$lib/engine/groups';
import { parentOn } from '$lib/engine/tree';
import { progressText } from '$lib/engine/progress';
import { cueClock, stillAhead } from '$lib/engine/day';
import type { LeftOpen } from '$lib/engine/rollup';
import { NOTE_MAX, type ScheduleForm } from '$lib/forms';
import { activeOptions, findOption, optionName } from '$lib/options';
import type { Level } from '$lib/engine/streak';
import { ActionError, canSeeHabit, requireScope, type Actor } from './actor';
import { emit, lastEventOn } from './events';
import { buildDay, change, dayOf, findHabit, occurrenceFor, type Day, type HabitRow, type OccRow } from './day';
import { isRoutine, kidsOn, markedBy } from '../rollup';
import { syncTree } from '../today';

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
	/** A routine's habits still open after its Done: one waits for its time today, or needs values first. */
	left?: LeftOpen[];
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
	const kids = routineKids(occ, actor);
	if (kids) {
		// A routine is done through the habits inside it: each one still open gets its one tap,
		// except one whose time today is still ahead (an evening pill at 5 AM): it stays due.
		const later = timesAhead(actor, occ.date, kids.map((k) => k.habit.id));
		inside(occ.id, () => {
			for (const k of kids) if (k.occ.status !== 'done' && k.occ.status !== 'skipped' && !later.has(k.habit.id)) doneOcc(actor, k.occ, oneTap(k.occ), level);
		});
		const now = recountRoutine(actor, occ);
		if (now?.status !== 'done') return 'needsInput';
		emit(actor, 'occurrence.done', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, level: now.level ?? null, how, ...via() } });
		return 'done';
	}
	const r = doneOne(actor, occ, how, level);
	syncAbove(actor, occ);
	return r;
}

function doneOne(actor: Actor, occ: OccRow, how: DoneHow, level: Level | null): 'done' | 'needsInput' | 'gone' {
	let r: 'done' | 'needsInput' | 'gone';
	// Nothing logged yet: all the log holds after this came from this one tap, which Undo takes away.
	const fresh = how !== 'mark' && !hasLog(occ.id);
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
		emit(actor, 'occurrence.done', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, level: now?.level ?? null, how, fresh, ...via() } });
	}
	return r;
}

/**
 * Whether Undo takes away what the log holds: the day was last done by one tap on an empty log
 * (one-tap Done, Same as last), with nothing saved since. For an Undo that doesn't say, such as
 * Today's row after a reload.
 */
export function undoClears(actor: Actor, occ: OccRow): boolean {
	const e = lastEventOn(actor.accountId, occ.habitId, occ.date, ['occurrence.done', 'log.saved', 'sets.logged', 'value.logged', 'occurrence.reopened']);
	return e?.type === 'occurrence.done' && e.data.occurrenceId === occ.id && e.data.fresh === true;
}

/**
 * Skip. `keepLogged`: a routine leaves the habits inside it that have something logged as they
 * are, as skipping days in bulk does.
 */
export function skipOcc(actor: Actor, occ: OccRow, opts: { keepLogged?: boolean } = {}) {
	const kids = routineKids(occ, actor);
	// Skipping a routine skips the habits inside it that are still open; done ones stay done.
	inside(occ.id, () => {
		for (const k of kids ?? []) if (k.occ.status !== 'done' && k.occ.status !== 'skipped' && !(opts.keepLogged && hasLog(k.occ.id))) skipOcc(actor, k.occ, opts);
	});
	db.update(occurrence).set({ status: 'skipped', finishedAt: null, level: null }).where(eq(occurrence.id, occ.id)).run();
	if (kids) recountRoutine(actor, occ);
	else syncAbove(actor, occ);
	emit(actor, 'occurrence.skipped', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, ...via() } });
}

/** Something is logged in it: a value, a set, a tick. */
export const hasLog = (occurrenceId: string) => !!db.select({ id: entry.id }).from(entry).where(eq(entry.occurrenceId, occurrenceId)).get();

/**
 * Back to due; `clear` also removes what was logged (undoing a one-tap log). Undo on a routine
 * opens again only the habits inside it that its own Done or Skip marked, taking back what that
 * tap wrote; a habit done on its own stays done.
 */
export function reopenOcc(actor: Actor, occ: OccRow, clear: boolean) {
	const kids = isRoutine(occ.habitId, occ.date) ? markedBy(actor.accountId, occ) : null;
	inside(occ.id, () => {
		for (const k of kids ?? []) reopenOcc(actor, k.occ, k.occ.status === 'done' && undoClears(actor, k.occ));
	});
	reopen(occ.id, clear);
	if (kids) recountRoutine(actor, occ);
	else syncAbove(actor, occ);
	emit(actor, 'occurrence.reopened', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, cleared: clear } });
}

/** For a routine's day: the habits inside it that have a log that day. Null for any other habit, or a day none of them is due. */
function routineKids(occ: OccRow, actor?: Actor) {
	if (!isRoutine(occ.habitId, occ.date)) return null;
	// A past day: habits inside that were due and never logged are marked with it too.
	if (actor && occ.date < userToday(actor.accountId, actor.tz)) kidsDueOn(actor.accountId, occ.habitId, occ.date);
	const kids = kidsOn(occ.habitId, occ.date).filter((k) => !k.occ.extra);
	return kids.length ? kids : null;
}

/**
 * The habits whose time is still ahead today, each with that time: a cue time, or the start of
 * its part of the day. Empty for any other day, since a past day's times have all come.
 */
export function timesAhead(actor: Actor, date: string, habitIds: string[]): Map<string, string> {
	const out = new Map<string, string>();
	if (!habitIds.length || date !== userToday(actor.accountId, actor.tz)) return out;
	const s = getSettings(actor.accountId);
	const now = timeIn(actor.tz || s.timeZone);
	for (const h of db.select({ id: habit.id, cue: habit.cue }).from(habit).where(inArray(habit.id, habitIds)).all()) {
		const at = cueClock(h.cue, s.ranges);
		if (at && stillAhead(at, now, s.dayStart ?? '00:00')) out.set(h.id, at);
	}
	return out;
}

/** What a routine's day still has open: each habit inside, with its time when that is still ahead today. Empty for any other habit. */
export function leftOpen(actor: Actor, occ: Pick<OccRow, 'habitId' | 'date'>): LeftOpen[] {
	if (!isRoutine(occ.habitId, occ.date)) return [];
	const open = kidsOn(occ.habitId, occ.date).filter((k) => !k.occ.extra && (k.occ.status === 'due' || k.occ.status === 'missed'));
	const later = timesAhead(actor, occ.date, open.map((k) => k.habit.id));
	return open.map((k) => ({ habit: k.habit.name, at: later.get(k.habit.id) ?? null }));
}

/** A habit inside a routine done with the routine: its last log copied when it has one, else its targets. */
function oneTap(occ: OccRow): DoneHow {
	if (!hasSlots(occ)) return 'mark';
	const before = db
		.select({ id: occurrence.id })
		.from(occurrence)
		.innerJoin(entry, eq(entry.occurrenceId, occurrence.id))
		.where(and(eq(occurrence.habitId, occ.habitId), eq(occurrence.status, 'done')))
		.get();
	return before ? 'same' : 'targets';
}

/**
 * While a routine marks the habits inside it, they don't each judge it again: it is judged once
 * after. Each mark says which routine day made it (`via`), so its Undo takes back only those.
 */
const marking: string[] = [];
function inside(routineOcc: string, run: () => void) {
	marking.push(routineOcc);
	try {
		run();
	} finally {
		marking.pop();
	}
}
const via = (): { via?: string } => (marking.length ? { via: marking[marking.length - 1] } : {});

/** A habit inside a group or a routine (now, or on days it kept) changed: the days it counts toward are judged again. */
function syncAbove(actor: Actor, occ: OccRow) {
	if (marking.length) return;
	const h = db.select({ parentId: habit.parentId, earlierParents: habit.earlierParents }).from(habit).where(eq(habit.id, occ.habitId)).get();
	if (h && parentOn(h.parentId, h.earlierParents, occ.date)) syncTree(actor.accountId, userToday(actor.accountId, actor.tz));
}

/** The routine's day counted again from the habits inside it. */
function recountRoutine(actor: Actor, occ: OccRow) {
	syncTree(actor.accountId, userToday(actor.accountId, actor.tz));
	return db.select({ status: occurrence.status, level: occurrence.level }).from(occurrence).where(eq(occurrence.id, occ.id)).get();
}

/**
 * A past day's log taken away: back to missed if it was due, else gone. A routine's day is the
 * days of the habits inside it, so theirs are taken away too.
 */
export function clearOcc(actor: Actor, day: Pick<Day, 'habit' | 'schedule' | 'date' | 'today'>) {
	clearOne(actor, day.habit.id, day.schedule, day.date, day.today);
}

function clearOne(actor: Actor, habitId: string, schedule: ScheduleForm, date: string, today: string) {
	const occ = db.select().from(occurrence).where(and(eq(occurrence.habitId, habitId), eq(occurrence.date, date))).get();
	if (occ && isRoutine(habitId, date))
		for (const k of kidsOn(habitId, date)) {
			const s = db.select({ schedule: habit.schedule }).from(habit).where(eq(habit.id, k.habit.id)).get()?.schedule;
			if (!k.occ.extra && s) clearOne(actor, k.habit.id, s as ScheduleForm, date, today);
		}
	clearDay(actor.accountId, habitId, schedule, date, today);
	if (occ) emit(actor, 'occurrence.cleared', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id } });
}

/** +1 (or −1) toward a habit's one target, from Today. Reaching the target finishes it; going over a most reopens it. */
export function plusOcc(actor: Actor, occ: OccRow, by: 1 | -1) {
	const r = plusOne(occ.id, by);
	if (!r) return null;
	emit(actor, 'value.logged', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, value: by, total: r.value, how: 'plus' } });
	if (r.done && by > 0 && occ.status !== 'done')
		emit(actor, 'occurrence.done', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, level: occ.level ?? null, how: 'plus' } });
	if (!r.done && (by < 0 || r.less) && occ.status === 'done')
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
		if (r !== 'needsInput') return resultOf(occ.id);
		const left = leftOpen(actor, occ);
		return resultOf(occ.id, left.length ? { left } : { missing: missingRequired(occ.id) });
	});
}

export function logSkip(actor: Actor, input: { habit: string; date?: string | null; extra?: boolean }, opts: { keepLogged?: boolean } = {}): LogResult {
	requireScope(actor, 'log');
	const day = buildDay(actor, input.habit, input.date);
	return change(actor, day, () => {
		const occ = act(day, actor, input);
		if (occ.status === 'skipped') return resultOf(occ.id, { already: true });
		skipOcc(actor, occ, opts);
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

/** One place in a day's log (see engine/parts.ts): a Slot's Task, or a Task inside it. */
interface TaskInLog {
	taskId: string;
	path: string;
	name: string;
	/** "Circuit › Push-ups" for a Task inside another; its name at the top. */
	label: string;
	/** The place it is inside, and its round there when that place repeats. */
	parent: string | null;
	round: number | null;
	kids: number;
	metrics: (typeof metric.$inferSelect)[];
	/** Targets at the log's level, falling back to Target. */
	targets: Record<string, number>;
}

/** Every place in a day's log, top down, with the Task auto-filled Slots picked that day. */
function tasksOf(occ: OccRow): TaskInLog[] {
	const out: TaskInLog[] = [];
	const byPath = new Map<string, TaskInLog>();
	for (const p of positionsOf(occ)) {
		const t = db.select({ name: task.name }).from(task).where(eq(task.id, p.taskId)).get();
		if (!t) continue;
		const up = p.parent ? byPath.get(p.parent) : undefined;
		const it: TaskInLog = {
			taskId: p.taskId,
			path: p.path,
			name: t.name,
			label: up ? `${up.label} › ${t.name}` : t.name,
			parent: p.parent,
			round: p.round?.n ?? null,
			kids: p.kids,
			metrics: db.select().from(metric).where(and(eq(metric.taskId, p.taskId), eq(metric.archived, false))).orderBy(asc(metric.sortOrder)).all(),
			targets: targetsAt(p, occ.level)
		};
		byPath.set(p.path, it);
		out.push(it);
	}
	return out;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s*(›|>|\/)\s*/g, ' › ');
/** The places a Task reference names: by Task id, its path, "Circuit › Push-ups", or its name. */
const placesOf = (tasks: TaskInLog[], ref: string): TaskInLog[] => {
	for (const test of [(t: TaskInLog) => t.taskId === ref || t.path === ref, (t: TaskInLog) => norm(t.label) === norm(ref), (t: TaskInLog) => norm(t.name) === norm(ref)]) {
		const hit = tasks.filter(test);
		if (hit.length) return hit;
	}
	return [];
};

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
	// A Choice takes an option by id or by name, and stores the id.
	if (m.type === 'choice') {
		const c = findOption(m.choices, String(v));
		if (!c) throw new ActionError('invalid', `${m.name} is one of: ${activeOptions(m.choices).map((o) => o.name).join(', ')}.`);
		return c.id;
	}
	// Text fields can hold journal entries: private, like notes.
	requireScope(actor, 'notes');
	if (typeof v !== 'string') throw new ActionError('invalid', `${m.name} takes text.`);
	return v.slice(0, NOTE_MAX);
}

function fieldList(tasks: TaskInLog[], repeats: boolean) {
	return [...new Set(tasks.flatMap((t) => t.metrics.filter((m) => m.repeats === repeats).map((m) => `${t.label}: ${m.name}${m.unit ? ` (${m.unit})` : ''}`)))];
}

/**
 * Finish when it reached its target, or every step is done; a one-step log is done once
 * something is in it. Never while a required field is still empty.
 */
function reached(occId: string): boolean {
	if (missingRequired(occId).length) return false;
	const p = progressForIds([occId]).get(occId);
	if (!p) return true;
	// A most (less is better) isn't reached before the day ends: it is judged then, or when finished.
	return p.kind === 'amount' ? !p.less && p.value >= p.target : p.done >= p.total;
}

/**
 * After a value or a Task is logged: finish the log when asked to, or when it reached its
 * target. A day that is over is judged by the habit's rule, as Finish on the log page and
 * settling judge it: done when what is logged counts (it reached the Minimum, or anything is
 * logged with no Minimum), missed when it falls short. A required field still empty keeps it
 * open either way, unless `finish` is 'yes'.
 */
function finishIf(actor: Actor, occ: OccRow, finish: 'auto' | 'yes' | 'no', how: string) {
	const now = db.select({ status: occurrence.status }).from(occurrence).where(eq(occurrence.id, occ.id)).get();
	if (!now || now.status === 'done' || finish === 'no') return;
	const today = userToday(actor.accountId, actor.tz);
	const over = occ.date < today && (now.status === 'due' || now.status === 'missed');
	if (finish === 'yes' || reached(occ.id) || (over && !missingRequired(occ.id).length)) {
		db.update(occurrence).set({ status: 'done', finishedAt: new Date() }).where(eq(occurrence.id, occ.id)).run();
		if (finishAs(occ.id, today) !== 'done') return;
		emit(actor, 'occurrence.done', { habitId: occ.habitId, date: occ.date, data: { occurrenceId: occ.id, level: occ.level ?? null, how } });
	}
}

/**
 * Log one value: "add 250 ml of water", "20 minutes of Spanish", "mood: Good". Numbers are
 * added to what is logged so far, or replace it, as `mode` says or else the field's sameDay. With no field named, it is the
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
		// One place per Task: the first, as a single value is logged once.
		let tasks = tasksOf(occ).filter((t, i, all) => all.findIndex((x) => x.taskId === t.taskId) === i);
		if (input.task) {
			const t = placesOf(tasks, input.task)[0];
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
		const summary = (place(positionsOf(occ), mine).at.get(t.path) ?? []).find((e) => (e.values as Values)._summary);
		const before = summary ? (summary.values as Values)[m.id] : undefined;
		// Without a mode, the field says: a second coffee adds up, a second weigh-in replaces the first.
		if (numeric(m.type) && (input.mode ?? m.sameDay ?? 'add') === 'add' && typeof before === 'number')
			value = Math.round((before + (value as number)) * 1000) / 1000;
		db.transaction((tx) => {
			if (summary) tx.update(entry).set({ values: { ...(summary.values as Values), [m.id]: value }, path: t.path }).where(eq(entry.id, summary.id)).run();
			else
				tx.insert(entry)
					.values({ id: randomUUID(), occurrenceId: occ.id, taskId: t.taskId, path: t.path, values: { [m.id]: value, _summary: true }, sortOrder: mine.length })
					.run();
		});
		emit(actor, 'value.logged', {
			habitId: occ.habitId,
			date: occ.date,
			data: { occurrenceId: occ.id, taskId: t.taskId, metricId: m.id, value: m.type === 'text' ? null : given, total: m.type === 'text' ? null : value }
		});
		finishIf(actor, occ, input.finish ?? 'auto', 'value');
		const target = t.targets[m.id] ?? null;
		return { ...resultOf(occ.id), field: `${t.label}: ${m.name}`, value: m.type === 'text' ? '(saved)' : m.type === 'choice' ? optionName(m.choices, value) : value, target };
	});
}

/**
 * Log a Task in a day's log: its sets ("3 × 8 at 80 kg"), its once-per-log values and ticks
 * of the steps inside it. A Task inside another is named "Circuit › Push-ups"; in a Circuit
 * that repeats, `round` says which round (by default the first with nothing logged yet).
 * Replaces what was logged at that place unless `replace` is false, which adds the sets after
 * the ones already there. Fields are named by id or name.
 */
export function logTask(
	actor: Actor,
	input: {
		habit: string;
		date?: string | null;
		task: string;
		round?: number | null;
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
		const all = db.select().from(entry).where(eq(entry.occurrenceId, occ.id)).orderBy(asc(entry.sortOrder)).all();
		const { at } = place(positionsOf(occ), all);
		let places = placesOf(tasks, input.task);
		if (!places.length) {
			const names = [...new Set(tasks.map((x) => x.label))];
			throw new ActionError('not_found', `${day.habit.name} has no Task called “${input.task}” on ${day.date}. Tasks: ${names.join(', ') || 'none'}.`);
		}
		if (input.round != null) {
			places = places.filter((x) => x.round === input.round);
			if (!places.length) throw new ActionError('not_found', `${input.task} has no round ${input.round} on ${day.date}.`);
		}
		const t = places.find((x) => !at.get(x.path)?.length) ?? places[0];
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
		// Steps: the tick-only places right inside this one. A tick goes to the first one not ticked yet.
		const steps = tasks.filter((x) => x.parent === t.path && !x.kids && !x.metrics.length);
		const ticked = new Set(steps.filter((x) => at.get(x.path)?.length).map((x) => x.path));
		const ticks = (input.ticks ?? []).map((ref) => {
			const named = steps.filter((x) => x.taskId === ref || norm(x.name) === norm(ref));
			if (!named.length) throw new ActionError('not_found', `${t.name} has no step called “${ref}”. Steps: ${[...new Set(steps.map((x) => x.name))].join(', ') || 'none'}.`);
			const s = named.find((x) => !ticked.has(x.path)) ?? named[0];
			ticked.add(s.path);
			return s;
		});
		// A plain Yes or no Task (no fields, nothing inside) is ticked by logging it at all.
		const yesNo = !t.metrics.length && !t.kids;
		if (!sets.length && !Object.keys(single).length && !ticks.length && !yesNo)
			throw new ActionError('invalid', `Send sets, values or ticks for ${t.label}.`);

		const group = at.get(t.path) ?? [];
		const oldSets = group.filter((e) => !(e.values as Values)._summary && !isTick(e.values as Values)).map((e) => e.values as Values);
		const oldSingle = (group.find((e) => (e.values as Values)._summary)?.values ?? {}) as Values;
		const replace = input.replace ?? true;
		const nextSets = replace ? sets : [...oldSets, ...sets];
		const keptSingle = Object.fromEntries(Object.entries(oldSingle).filter(([k]) => k !== '_summary'));
		const nextSingle = replace && Object.keys(single).length ? single : { ...keptSingle, ...single };
		const newGroup: Values[] = [...nextSets, ...(Object.keys(nextSingle).length ? [{ ...nextSingle, _summary: true }] : [])];
		if (yesNo) newGroup.splice(0, newGroup.length, { done: true });
		const newTicks = ticks.filter((s) => !at.get(s.path)?.length);
		const first = group.length ? all.indexOf(group[0]) : all.length;
		const rest = all.filter((e) => !group.includes(e));
		const cut = rest.filter((e) => all.indexOf(e) < first).length;
		const order: ({ id: string } | { taskId: string; path: string; values: Values })[] = [
			...rest.slice(0, cut),
			...newGroup.map((values) => ({ taskId: t.taskId, path: t.path, values })),
			...newTicks.map((s) => ({ taskId: s.taskId, path: s.path, values: { done: true } })),
			...rest.slice(cut)
		];
		db.transaction((tx) => {
			if (group.length) tx.delete(entry).where(inArray(entry.id, group.map((e) => e.id))).run();
			order.forEach((e, i) => {
				if ('id' in e) tx.update(entry).set({ sortOrder: i }).where(eq(entry.id, e.id)).run();
				else tx.insert(entry).values({ id: randomUUID(), occurrenceId: occ.id, taskId: e.taskId, path: e.path, values: e.values, sortOrder: i }).run();
			});
		});
		emit(actor, 'sets.logged', {
			habitId: occ.habitId,
			date: occ.date,
			data: { occurrenceId: occ.id, taskId: t.taskId, path: t.path, sets: nextSets.length, replaced: replace, ticks: ticks.length }
		});
		finishIf(actor, occ, input.finish ?? 'auto', 'task');
		return { ...resultOf(occ.id), task: t.label, sets: nextSets.length };
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

/** A feeling given by id or by name, as the id of one of the habit's feelings. */
function feelingOf(h: HabitRow, given: string | null | undefined): string | null {
	if (!given?.trim()) return null;
	const f = findOption(h.triggers, given);
	if (!f) throw new ActionError('invalid', `The feeling is one of: ${activeOptions(h.triggers).map((o) => o.name).join(', ') || "none (add feelings to the habit first)"}.`);
	return f.id;
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
			feeling: feelingOf(h, input.feeling),
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
