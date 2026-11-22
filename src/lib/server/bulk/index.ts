// Bulk changes: one runner for every action in src/lib/bulk/catalog.ts. A preview runs the very
// same code as the change and then rolls it back, so what it lists is exactly what Apply does.
// Apply runs in one transaction, saves how to undo it as a batch, and tags every event it writes
// with the batch id. The core `bulk` and `bulk_undo` actions (core/actions.ts) call these, so the
// app, the API and the MCP server share them.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { bulkBatch } from '../db/schema';
import { userToday } from '../today';
import { ActionError, requireScope, type Actor } from '../core/actor';
import { emit } from '../core/events';
import { BULK, TARGETS, type BulkInput, type BulkMeta, type BulkName } from '$lib/bulk/catalog';
import { Reporter, plural, type Report } from './report';
import { select } from './select';
import { UndoLog, undoAll, type UndoOp, type UndoResult } from './undo';
import type { Ctx, Run } from './types';
import { skipDays, skipPicked } from './skip';
import { pauseHabits } from './pause';
import { archiveHabits, archiveTasks } from './archive';
import { setFields } from './set';
import { convertUnit } from './unit';

/** Each catalog entry's server side. Leaving one out is a type error. */
const RUN: { [N in BulkName]: Run<N> } = {
	skip_days: skipDays,
	pause: pauseHabits,
	skip: skipPicked,
	archive: archiveHabits,
	archive_tasks: archiveTasks,
	set: setFields,
	convert_unit: convertUnit
};

export type BulkAnswer = Report & { preview: boolean; batch: string | null };

/** Thrown inside a transaction to roll it back while keeping what it found. */
class Rollback<T> extends Error {
	constructor(public value: T) {
		super('rollback');
	}
}

function dryRun<T>(fn: () => T): T {
	try {
		db.transaction(() => {
			throw new Rollback(fn());
		});
	} catch (e) {
		if (e instanceof Rollback) return e.value as T;
		throw e;
	}
	throw new Error('unreachable');
}

/** Preview a bulk change, or apply it with `apply: true`. */
export function runBulk(actor: Actor, input: BulkInput): BulkAnswer {
	const { name, ...args } = input.action;
	const meta: BulkMeta = BULK[name];
	requireScope(actor, meta.scope);
	const selected = select(actor, meta.target, input);
	const today = userToday(actor.accountId, actor.tz);
	const t = TARGETS[meta.target];
	const exec = (a: Actor) => {
		const ctx: Ctx = { actor: a, today, undo: new UndoLog(), report: new Reporter() };
		(RUN[name] as Run<BulkName>)(ctx, selected.rows as never, args as never);
		return { report: ctx.report.build((n) => `${meta.title}: ${plural(n, t.one, t.many)}`), undo: ctx.undo.ops };
	};
	if (!input.apply) return { preview: true, batch: null, ...dryRun(() => exec(actor).report) };

	const id = randomUUID();
	const a: Actor = { ...actor, batch: id };
	return db.transaction(() => {
		const { report, undo } = exec(a);
		// Nothing changed: no batch to undo.
		if (!report.count || !undo.length) return { preview: false, batch: null, ...report };
		db.insert(bulkBatch)
			.values({ id, accountId: actor.accountId, action: name, request: { action: input.action, ids: selected.rows.map((r) => r.id) }, summary: report.summary, undo, createdAt: new Date() })
			.run();
		emit(a, 'bulk.applied', { data: { action: name, count: report.count, ids: report.changes.map((c) => c.id) } });
		return { preview: false, batch: id, ...report };
	});
}

/**
 * Undo a bulk change. Only the latest one not undone yet, so two batches never undo each other
 * out of order. What was changed again since is kept, and counted.
 */
export function undoBulk(actor: Actor, batchId: string): UndoResult & { undone: string; batch: string } {
	const b = db
		.select()
		.from(bulkBatch)
		.where(and(eq(bulkBatch.id, batchId), eq(bulkBatch.accountId, actor.accountId)))
		.get();
	if (!b) throw new ActionError('not_found', 'No bulk change with that id.');
	if (b.undoneAt) throw new ActionError('conflict', 'That bulk change was already undone.');
	const latest = db
		.select({ id: bulkBatch.id, summary: bulkBatch.summary })
		.from(bulkBatch)
		.where(and(eq(bulkBatch.accountId, actor.accountId), isNull(bulkBatch.undoneAt)))
		.orderBy(desc(bulkBatch.createdAt), desc(sql`rowid`))
		.get();
	if (latest && latest.id !== b.id) throw new ActionError('conflict', `Undo the later bulk change first: “${latest.summary}”.`);
	const meta: BulkMeta | undefined = BULK[b.action as BulkName];
	if (meta) requireScope(actor, meta.scope);
	const a: Actor = { ...actor, batch: b.id };
	return db.transaction(() => {
		const r = undoAll(a, b.undo as UndoOp[], userToday(actor.accountId, actor.tz));
		db.update(bulkBatch).set({ undoneAt: new Date() }).where(eq(bulkBatch.id, b.id)).run();
		emit(a, 'bulk.undone', { data: { action: b.action, ...r } });
		return { undone: b.summary, batch: b.id, ...r };
	});
}
