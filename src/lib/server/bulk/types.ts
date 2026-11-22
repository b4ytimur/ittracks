// What every bulk action's run function gets: who is acting (with the batch id, so the events it
// writes carry it), today, where to record its Undo, and where to report each item.
import type { z } from 'zod';
import type { Actor } from '../core/actor';
import type { BULK, BulkName } from '$lib/bulk/catalog';
import type { Reporter } from './report';
import type { Selected } from './select';
import type { UndoLog } from './undo';

export interface Ctx {
	actor: Actor;
	today: string;
	undo: UndoLog;
	report: Reporter;
}

type RowsOf<N extends BulkName> = Extract<Selected, { kind: (typeof BULK)[N]['target'] }>['rows'];

/** One action's server side: changes the selected rows, recording Undo and reporting each item. */
export type Run<N extends BulkName> = (ctx: Ctx, rows: RowsOf<N>, input: z.infer<(typeof BULK)[N]['input']>) => void;
