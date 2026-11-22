// Finding what an action is about: a habit by id or name, a day, and that habit's log on that
// day. Follows the same rules as Today and the past-day page: past days only within the
// window set in Settings, never before a habit's start, never in the future, and a past
// change plans today again and recounts misses, exactly as the Day page does.
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { habit, occurrence, variant } from '../db/schema';
import { ensureToday, pausesOf, recount, userToday } from '../today';
import { occurrenceOn, planOfToday, replanToday, windowFor } from '../backfill';
import { isRealDate } from '$lib/engine/backfill';
import { pauseOn } from '$lib/engine/pause';
import type { ScheduleForm } from '$lib/forms';
import { isGroup, type Schedule } from '$lib/engine/schedule';
import { ActionError, canSeeHabit, type Actor } from './actor';

export type HabitRow = typeof habit.$inferSelect;
export type OccRow = typeof occurrence.$inferSelect;

/** Habits this actor may see, active first. */
export function visibleHabits(actor: Actor, opts: { archived?: boolean } = {}): HabitRow[] {
	return db
		.select()
		.from(habit)
		.where(and(eq(habit.accountId, actor.accountId), opts.archived ? undefined : eq(habit.archived, false)))
		.orderBy(asc(habit.archived), asc(habit.sortOrder), asc(habit.name))
		.all()
		.filter((h) => canSeeHabit(actor, h.id));
}

/** A habit by id, or by name (any case) so Siri and assistants can say "water". */
export function findHabit(actor: Actor, ref: string): HabitRow {
	const r = ref.trim();
	const all = visibleHabits(actor, { archived: true });
	const byId = all.find((h) => h.id === r);
	if (byId) return byId;
	const named = all.filter((h) => h.name.trim().toLowerCase() === r.toLowerCase());
	const active = named.filter((h) => !h.archived);
	if (active.length === 1) return active[0];
	if (!active.length && named.length === 1) return named[0];
	if (named.length > 1) throw new ActionError('conflict', `More than one habit is called “${r}”. Use its id.`, { ids: named.map((h) => h.id) });
	// A start of a name is enough when it points at one habit: "spanish" for "Spanish practice".
	const q = r.toLowerCase();
	const starts = all.filter((h) => !h.archived && h.name.trim().toLowerCase().startsWith(q));
	if (q.length >= 3 && starts.length === 1) return starts[0];
	// Or a whole word of it: "water" for "Drink water".
	const word = new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u');
	const words = all.filter((h) => !h.archived && word.test(h.name.toLowerCase()));
	if (q.length >= 3 && !starts.length && words.length === 1) return words[0];
	if (starts.length > 1 || words.length > 1)
		throw new ActionError('conflict', `“${r}” could be ${[...new Set([...starts, ...words])].map((h) => h.name).join(' or ')}. Use the full name or the id.`);
	throw new ActionError('not_found', `No habit called “${r}”.`);
}

/** The day an action is about: `date` (YYYY-MM-DD), "today", "yesterday", or today when left out. */
export function dayOf(actor: Actor, date?: string | null): { date: string; today: string } {
	const today = userToday(actor.accountId, actor.tz);
	if (!date || date === 'today') return { date: today, today };
	if (date === 'yesterday') {
		const d = new Date(`${today}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() - 1);
		return { date: d.toISOString().slice(0, 10), today };
	}
	if (!isRealDate(date)) throw new ActionError('invalid', `“${date}” is not a date. Use YYYY-MM-DD.`);
	if (date > today) throw new ActionError('invalid', `${date} is in the future. Today is ${today}.`);
	return { date, today };
}

export interface Day {
	habit: HabitRow;
	schedule: ScheduleForm;
	date: string;
	today: string;
	past: boolean;
}

/** A build habit on a day, checked against the start date and the past-day window. */
export function buildDay(actor: Actor, habitRef: string, date?: string | null): Day {
	const h = findHabit(actor, habitRef);
	if (h.direction !== 'build' || !h.schedule) throw new ActionError('invalid', `${h.name} is a break habit: log a slip instead.`);
	if (isGroup(h.schedule as Schedule)) throw new ActionError('invalid', `${h.name} is a group: its day comes from the habits inside it. Log one of those instead.`);
	if (h.archived) throw new ActionError('invalid', `${h.name} is archived.`);
	const d = dayOf(actor, date);
	if (d.date < h.startDate) throw new ActionError('invalid', `${h.name} started on ${h.startDate}.`);
	const past = d.date < d.today;
	if (past) {
		const w = windowFor(actor.accountId, d.date, d.today);
		if (w === 'off') throw new ActionError('forbidden', 'Logging past days is off in Settings.');
		if (w === 'tooOld') throw new ActionError('forbidden', `${d.date} is too far back to log. You can change how far back in Settings → Past days.`);
	}
	return { habit: h, schedule: h.schedule as ScheduleForm, date: d.date, today: d.today, past };
}

/**
 * The habit's log on that day, created when there is none. Today uses the schedule; a day
 * the schedule has nothing due needs `extra` (as "Start early" or logging a day off would).
 */
export function occurrenceFor(actor: Actor, day: Day, opts: { extra?: boolean; variant?: string | null } = {}): OccRow {
	const { habit: h, schedule, date, today } = day;
	if (date === today) {
		const occ = ensureToday(actor.accountId, h.id, schedule, today);
		if (occ) return db.select().from(occurrence).where(eq(occurrence.id, occ.id)).get()!;
		if (pauseOn(pausesOf(actor.accountId), h.id, today)) throw new ActionError('not_due', `${h.name} is paused today.`);
		if (!opts.extra) throw new ActionError('not_due', `${h.name} isn't due today. To log it anyway, send extra: true (or add &extra=1 to a link).`);
	} else {
		const existing = db.select().from(occurrence).where(and(eq(occurrence.habitId, h.id), eq(occurrence.date, date))).get();
		if (existing) return existing;
	}
	const variantId = opts.variant ? variantOf(h.id, opts.variant) : null;
	const occ = occurrenceOn(actor.accountId, h, date, variantId);
	if (!occ) throw new ActionError('not_due', `${h.name} has nothing to log.`);
	return db.select().from(occurrence).where(eq(occurrence.id, occ.id)).get()!;
}

/** A Variant of the habit by id or name. */
function variantOf(habitId: string, ref: string): string {
	const rows = db.select({ id: variant.id, name: variant.name }).from(variant).where(eq(variant.habitId, habitId)).all();
	const v = rows.find((x) => x.id === ref) ?? rows.find((x) => x.name.toLowerCase() === ref.toLowerCase());
	if (!v) throw new ActionError('not_found', `No Variant called “${ref}”. Pick one of: ${rows.map((x) => x.name).join(', ')}.`);
	return v.id;
}

/**
 * Run a change to a habit's day. A past day can change what is due today (a weekly target
 * met, a rotation moved on) and which earlier days count as missed, so both are worked out
 * again afterwards, as the Day page does.
 */
export function change<T>(actor: Actor, day: Day, run: () => T): T {
	const before = day.past ? planOfToday(day.habit.id, day.schedule, day.today) : null;
	const out = run();
	if (day.past) {
		replanToday(actor.accountId, day.habit.id, day.schedule, day.today, before);
		recount(actor.accountId, day.habit.id, day.schedule, day.date, day.today);
	}
	return out;
}
