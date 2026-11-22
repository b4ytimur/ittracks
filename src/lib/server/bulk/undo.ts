// Undo for a bulk change: while it runs, each action records what it is about to change, and
// Undo puts those things back in reverse order. One mechanism for every action, in six kinds:
//
// - row: columns of a row, before and after (a field's unit, logged values, targets);
// - habit: bulk-editable habit fields, put back through the same write as the change, so a
//   field's effect is undone with it (habit-fields.ts);
// - day: a habit's whole day before and after (src/lib/server/backfill.ts snapshots);
// - pause: a pause the change added, taken away again;
// - archive: a habit or Task archived or brought back, the other way again (archive.ts);
// - convert: values logged after a unit conversion, converted back with it.
//
// Anything changed again since the batch (a day logged by hand, a value edited) is left as it
// is and counted as kept, so Undo never overwrites a later change.
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { entry, habit, metric, occurrence, pause, slot, taskPart } from '../db/schema';
import { planOfToday, replanToday, restore, snapshot, type Snapshot } from '../backfill';
import { recount, repaused } from '../today';
import { roundConverted } from '$lib/units';
import type { ScheduleForm } from '$lib/forms';
import type { OnWrite } from '../history';
import type { Actor } from '../core/actor';
import type { HabitBulkField } from '$lib/rules/habit';
import { habitFieldsNow, writeHabitFields } from './habit-fields';
import { ARCHIVE, type ArchiveKind } from './archive';

const TABLES = { habit, metric, entry, slot, taskPart, occurrence } as const;
export type RowTable = keyof typeof TABLES;

export type UndoOp =
	| { k: 'row'; t: RowTable; id: string; before: Record<string, unknown>; after: Record<string, unknown> }
	| { k: 'habit'; id: string; before: Partial<Record<HabitBulkField, unknown>>; after: Partial<Record<HabitBulkField, unknown>> }
	| { k: 'day'; before: Snapshot; after: Snapshot }
	| { k: 'pause'; id: string }
	| { k: 'archive'; t: ArchiveKind; id: string; archived: boolean }
	| { k: 'convert'; taskId: string; metricId: string; unitBefore: string | null; factor: number; entries: string[] };

/** What a running bulk change records for its Undo. */
export class UndoLog {
	ops: UndoOp[] = [];

	row(t: RowTable, id: string, before: Record<string, unknown>, after: Record<string, unknown>) {
		this.ops.push({ k: 'row', t, id, before, after });
	}

	habit(id: string, before: Partial<Record<HabitBulkField, unknown>>, after: Partial<Record<HabitBulkField, unknown>>) {
		this.ops.push({ k: 'habit', id, before, after });
	}

	day(before: Snapshot, after: Snapshot) {
		this.ops.push({ k: 'day', before, after });
	}

	pause(id: string) {
		this.ops.push({ k: 'pause', id });
	}

	/** `archived`: what the change set it to. */
	archive(t: ArchiveKind, id: string, archived: boolean) {
		this.ops.push({ k: 'archive', t, id, archived });
	}

	/** Recorded before the field's unit changes, so Undo reaches it after the unit is back. */
	convert(op: Omit<Extract<UndoOp, { k: 'convert' }>, 'k'>): Extract<UndoOp, { k: 'convert' }> {
		const o = { k: 'convert' as const, ...op };
		this.ops.push(o);
		return o;
	}

	/** For code that reports its writes (convertMetricValues). */
	get onWrite(): OnWrite {
		return (t, id, before, after) => this.row(t, id, before, after);
	}
}

/** Same value, whatever the order of an object's keys. */
export function same(a: unknown, b: unknown): boolean {
	return stable(a) === stable(b);
}
function stable(v: unknown): string {
	if (v === undefined) return 'null';
	if (v === null || typeof v !== 'object') return JSON.stringify(v);
	if (v instanceof Date) return JSON.stringify(v.getTime());
	if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
	return `{${Object.keys(v)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
		.join(',')}}`;
}

export interface UndoResult {
	/** Things put back. */
	restored: number;
	/** Things changed again since, left as they are. */
	kept: number;
}

/** Put back what a batch changed, newest first. Runs inside the caller's transaction. */
export function undoAll(actor: Actor, ops: UndoOp[], today: string): UndoResult {
	const r: UndoResult = { restored: 0, kept: 0 };
	for (const op of [...ops].reverse()) {
		const ok = UNDO[op.k](actor, op as never, today);
		if (ok === null) continue;
		r[ok ? 'restored' : 'kept']++;
	}
	return r;
}

type Op<K extends UndoOp['k']> = Extract<UndoOp, { k: K }>;

/** How each kind is undone: true put back, false changed since and kept, null nothing to do. */
const UNDO: { [K in UndoOp['k']]: (actor: Actor, op: Op<K>, today: string) => boolean | null } = {
	row: (_a, op) => undoRow(op),
	habit: (_a, op) => undoHabit(op),
	day: undoDay,
	pause: undoPause,
	archive: undoArchive,
	convert: (_a, op) => undoConvert(op)
};

function undoHabit(op: Op<'habit'>): boolean {
	const now = habitFieldsNow(op.id, Object.keys(op.after) as HabitBulkField[]);
	if (!now || Object.keys(op.after).some((k) => !same(now[k as HabitBulkField], op.after[k as HabitBulkField]))) return false;
	writeHabitFields(op.id, op.after, op.before);
	return true;
}

function undoArchive(actor: Actor, op: Op<'archive'>, today: string): boolean {
	const kind = ARCHIVE[op.t];
	if (kind.isArchived(actor.accountId, op.id) !== op.archived) return false;
	kind.set(actor.accountId, op.id, !op.archived, today);
	return true;
}

function undoRow(op: Extract<UndoOp, { k: 'row' }>): boolean {
	const t = TABLES[op.t];
	const now = db.select().from(t).where(eq(t.id, op.id)).get() as Record<string, unknown> | undefined;
	if (!now) return false;
	if (Object.keys(op.after).some((k) => !same(now[k], op.after[k]))) return false;
	db.update(t).set(op.before).where(eq(t.id, op.id)).run();
	return true;
}

function undoDay(actor: Actor, op: Extract<UndoOp, { k: 'day' }>, today: string): boolean {
	const { habitId, date } = op.before;
	if (!same(snapshot(habitId, date), op.after)) return false;
	const h = db.select().from(habit).where(and(eq(habit.id, habitId), eq(habit.accountId, actor.accountId))).get();
	if (!h?.schedule) return false;
	const schedule = h.schedule as ScheduleForm;
	// As Undo on the Day page: today is planned again and misses counted again after it.
	const plan = planOfToday(h.id, schedule, today);
	if (!restore(actor.accountId, op.before)) return false;
	replanToday(actor.accountId, h.id, schedule, today, plan);
	recount(actor.accountId, h.id, schedule, date, today);
	return true;
}

function undoPause(actor: Actor, op: Extract<UndoOp, { k: 'pause' }>, today: string): boolean {
	const where = and(eq(pause.id, op.id), eq(pause.accountId, actor.accountId));
	const p = db.select().from(pause).where(where).get();
	if (!p) return false;
	db.delete(pause).where(where).run();
	// As taking a pause away in the editor: misses are counted again for its past days.
	repaused(actor.accountId, p.habitId, p.start, p.end, today);
	return true;
}

/**
 * Values logged after a conversion are in the new unit: once the field's unit is back to the
 * old one, they are converted back too. Null: nothing was logged since.
 */
function undoConvert(op: Extract<UndoOp, { k: 'convert' }>): boolean | null {
	const m = db.select({ unit: metric.unit }).from(metric).where(eq(metric.id, op.metricId)).get();
	if (!m || (m.unit ?? null) !== op.unitBefore) return null;
	const known = new Set(op.entries);
	let n = 0;
	for (const e of db.select({ id: entry.id, values: entry.values }).from(entry).where(eq(entry.taskId, op.taskId)).all()) {
		const v = e.values?.[op.metricId];
		if (known.has(e.id) || typeof v !== 'number') continue;
		db.update(entry).set({ values: { ...e.values, [op.metricId]: roundConverted(v / op.factor) } }).where(eq(entry.id, e.id)).run();
		n++;
	}
	return n ? true : null;
}
