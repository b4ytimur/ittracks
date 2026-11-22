// Undo for a bulk change: while it runs, each action records what it is about to change, and
// Undo puts those things back in reverse order. One mechanism for every action, in four kinds:
//
// - row: columns of a row, before and after (a habit's Area, a field's unit, logged values);
// - day: a habit's whole day before and after (src/lib/server/backfill.ts snapshots);
// - pause: a pause the change added, taken away again;
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

const TABLES = { habit, metric, entry, slot, taskPart, occurrence } as const;
export type RowTable = keyof typeof TABLES;

export type UndoOp =
	| { k: 'row'; t: RowTable; id: string; before: Record<string, unknown>; after: Record<string, unknown> }
	| { k: 'day'; before: Snapshot; after: Snapshot }
	| { k: 'pause'; id: string }
	| { k: 'convert'; taskId: string; metricId: string; unitBefore: string | null; factor: number; entries: string[] };

/** What a running bulk change records for its Undo. */
export class UndoLog {
	ops: UndoOp[] = [];

	row(t: RowTable, id: string, before: Record<string, unknown>, after: Record<string, unknown>) {
		this.ops.push({ k: 'row', t, id, before, after });
	}

	day(before: Snapshot, after: Snapshot) {
		this.ops.push({ k: 'day', before, after });
	}

	pause(id: string) {
		this.ops.push({ k: 'pause', id });
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
		const ok =
			op.k === 'row' ? undoRow(op) : op.k === 'day' ? undoDay(actor, op, today) : op.k === 'pause' ? undoPause(actor, op, today) : undoConvert(op);
		if (ok === null) continue;
		r[ok ? 'restored' : 'kept']++;
	}
	return r;
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
