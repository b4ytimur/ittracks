// The event log: one row for everything that happened, whoever did it. Append-only: rows are
// never changed, and undoing something adds an event of its own. Webhooks, reminders by ntfy
// or Telegram, and feeds will read from here later. Notes and journal text never go in.
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../db';
import { event } from '../db/schema';
import type { Actor } from './actor';

/**
 * Every event type, with what its data holds. Bump the version when a type's data changes shape.
 * Any event can also carry `batch`: the bulk change it was part of.
 */
export const EVENT_TYPES = {
	'occurrence.done': {
		v: 2,
		about: 'A habit was done for a day. data: occurrenceId, level, how, fresh (the log held nothing before, so everything in it came from this; v2)'
	},
	'occurrence.skipped': { v: 1, about: 'A habit was skipped for a day. data: occurrenceId' },
	'occurrence.reopened': { v: 1, about: 'A done or skipped day was put back to due (Undo). data: occurrenceId, cleared' },
	'occurrence.cleared': { v: 1, about: "A past day's log was taken away. data: occurrenceId" },
	'occurrence.restored': { v: 1, about: 'Undo on the Day page put a day back as it was before the last change. data: none' },
	'value.logged': { v: 2, about: "A value was logged for a field. A Choice's value is its option's id (describe lists the options). data: occurrenceId, taskId, metricId, value, total" },
	'sets.logged': { v: 1, about: 'Sets or values were logged for a Task. data: occurrenceId, taskId, sets, replaced' },
	'log.saved': { v: 1, about: 'The full log screen saved a finished log. data: occurrenceId, entries' },
	'slip.logged': { v: 1, about: 'A slip of a break habit. data: slipId, count' },
	'slip.removed': { v: 1, about: 'A slip was taken back. data: slipId' },
	'craving.resisted': { v: 1, about: 'A craving was resisted. data: cravingId' },
	'craving.removed': { v: 1, about: 'A resisted craving was taken back. data: cravingId' },
	'note.saved': { v: 1, about: 'A note was saved (the text is never in the event). data: kind, occurrenceId' },
	'data.imported': { v: 1, about: 'A full export was restored into this account. data: counts' },
	'bulk.applied': { v: 1, about: 'A bulk change ran (src/lib/bulk/catalog.ts). Events it wrote carry the same batch. data: batch, action, count, ids' },
	'bulk.undone': { v: 1, about: 'A bulk change was undone. data: batch, action, restored, kept' },
	'metric.unit_changed': {
		v: 1,
		about: "A field's unit changed after it had values. Converted: its past values (and targets) were multiplied by factor; otherwise they kept their numbers. data: taskId, metricId, from, to, converted, factor"
	}
} as const;
export type EventType = keyof typeof EVENT_TYPES;

export function emit(
	actor: Actor,
	type: EventType,
	e: { habitId?: string | null; date?: string | null; data?: Record<string, unknown> } = {}
) {
	db.insert(event)
		.values({
			accountId: actor.accountId,
			at: new Date(),
			type,
			v: EVENT_TYPES[type].v,
			habitId: e.habitId ?? null,
			date: e.date ?? null,
			source: actor.source,
			tokenId: actor.tokenId,
			data: actor.batch ? { ...(e.data ?? {}), batch: actor.batch } : (e.data ?? {})
		})
		.run();
}

export interface EventRow {
	seq: number;
	at: string;
	type: string;
	v: number;
	habitId: string | null;
	date: string | null;
	source: string;
	data: Record<string, unknown>;
}

/** Events after a sequence number, oldest first. A key limited to some habits sees only theirs. */
export function listEvents(actor: Actor, opts: { after?: number; limit?: number; types?: string[] } = {}): EventRow[] {
	const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
	const rows = db
		.select()
		.from(event)
		.where(
			and(
				eq(event.accountId, actor.accountId),
				gt(event.seq, opts.after ?? 0),
				opts.types?.length ? inArray(event.type, opts.types) : undefined,
				// Filtered in the query, so paging by seq never skips a limited key's events.
				actor.habitIds ? inArray(event.habitId, actor.habitIds.size ? [...actor.habitIds] : ['']) : undefined
			)
		)
		.orderBy(asc(event.seq))
		.limit(limit)
		.all();
	return rows
		.map((r) => ({ seq: r.seq, at: r.at.toISOString(), type: r.type, v: r.v, habitId: r.habitId, date: r.date, source: r.source, data: r.data }));
}

/** The newest event of some types about one day of a habit. */
export function lastEventOn(accountId: string, habitId: string, date: string, types: EventType[]): EventRow | undefined {
	const r = db
		.select()
		.from(event)
		.where(and(eq(event.accountId, accountId), eq(event.habitId, habitId), eq(event.date, date), inArray(event.type, types)))
		.orderBy(desc(event.seq))
		.limit(1)
		.get();
	return r && { seq: r.seq, at: r.at.toISOString(), type: r.type, v: r.v, habitId: r.habitId, date: r.date, source: r.source, data: r.data };
}
