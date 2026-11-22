// archive and archive_tasks: archive many habits or Library Tasks, or bring them back, through
// the same functions as the Habits list and the Library (habit-actions.ts, repo/tasks.ts). Bulk
// never deletes: archived items keep every log. Undo goes back through the same functions.
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { habit, task } from '../db/schema';
import { archiveHabit, unarchiveHabit } from '../habit-actions';
import { setTaskArchived } from '../repo/tasks';
import { TARGETS } from '$lib/bulk/catalog';
import { plural } from './report';
import type { Ctx, Run } from './types';
import type { HabitRow } from '../core/day';
import type { TaskRow } from './select';

export type ArchiveKind = 'habit' | 'task';

/** Per kind: whether an item is archived now, and how to archive it or bring it back. */
export const ARCHIVE: Record<ArchiveKind, { isArchived: (accountId: string, id: string) => boolean | null; set: (accountId: string, id: string, archived: boolean, today: string) => void }> = {
	habit: {
		isArchived: (accountId, id) => db.select({ a: habit.archived }).from(habit).where(and(eq(habit.id, id), eq(habit.accountId, accountId))).get()?.a ?? null,
		// Archiving counts the misses up to today first; bringing back skips the days spent archived.
		set: (accountId, id, archived, today) => void (archived ? archiveHabit(accountId, id, today) : unarchiveHabit(accountId, id, today))
	},
	task: {
		isArchived: (accountId, id) => db.select({ a: task.archived }).from(task).where(and(eq(task.id, id), eq(task.accountId, accountId))).get()?.a ?? null,
		set: (accountId, id, archived) => void setTaskArchived(accountId, id, archived)
	}
};

function run(kind: ArchiveKind, { actor, today, undo, report }: Ctx, rows: { id: string; name: string; archived: boolean }[], archived: boolean, picked: Set<string>) {
	const t = TARGETS[kind];
	for (const r of rows) {
		const line = { id: r.id, label: r.name };
		if (r.archived === archived) {
			report.skip(archived ? 'Already archived' : 'Not archived', line);
			continue;
		}
		ARCHIVE[kind].set(actor.accountId, r.id, archived, today);
		undo.archive(kind, r.id, archived);
		report.change(line);
		// A group or routine is archived on its own; the habits inside it stay as they are.
		if (kind === 'habit' && archived) {
			const inside = db
				.select({ id: habit.id, name: habit.name })
				.from(habit)
				.where(and(eq(habit.parentId, r.id), eq(habit.archived, false)))
				.all()
				.filter((h) => !picked.has(h.id));
			if (inside.length) report.note(`The habits inside ${r.name} stay as they are (${inside.map((h) => h.name).join(', ')}). Select them too to archive them.`);
		}
	}
	report.summary(report.count ? `${archived ? 'Archived' : 'Brought back'} ${plural(report.count, t.one, t.many)}` : 'Nothing to change');
}

export const archiveHabits: Run<'archive'> = (ctx, habits: HabitRow[], { archived }) => run('habit', ctx, habits, archived, new Set(habits.map((h) => h.id)));
export const archiveTasks: Run<'archive_tasks'> = (ctx, tasks: TaskRow[], { archived }) => run('task', ctx, tasks, archived, new Set());
