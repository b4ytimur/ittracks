// A save from a page that is out of date: what is here now, for the page to choose from.
import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { entry } from './db/schema';
import { revOf, type LogContent } from '$lib/logrev';

export function contentOf(occ: { id: string; notes: string | null; level: string | null }): LogContent {
	const entries = db.select().from(entry).where(eq(entry.occurrenceId, occ.id)).orderBy(asc(entry.sortOrder)).all();
	return { entries: entries.map((e) => ({ taskId: e.taskId, path: e.path, values: e.values })), notes: occ.notes ?? '', level: occ.level ?? 'target' };
}

/**
 * Null when `next` may be saved: the log is as one of `bases` (what the page's log grew from), or
 * already holds exactly this. Without `bases` (a save queued by an older version) anything may be.
 */
export function staleSave(occ: { id: string; notes: string | null; level: string | null }, next: LogContent, bases?: string[]) {
	if (!bases) return null;
	const now = contentOf(occ);
	const rev = revOf(now);
	return bases.includes(rev) || rev === revOf(next) ? null : { rev, ...now };
}
