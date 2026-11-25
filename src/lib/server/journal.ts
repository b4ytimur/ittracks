// The journal on the server: day notes, and the feed of everything written per day (journal
// fields, log notes, slip notes, the day note). Private: nothing here is ever exported as a
// template or shared; only the owner's Markdown export reads it.
import { and, asc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from './db';
import { dayNote, entry, habit, metric, occurrence, slip, task } from './db/schema';
import { NOTE_MAX } from '$lib/forms';
import type { JournalDay, JournalItem } from '$lib/journal';
import { optionName, scoresOn, type ChoiceOption, type EarlierScores, type Scores } from '$lib/options';

export function getDayNote(accountId: string, date: string): string {
	return db.select({ text: dayNote.text }).from(dayNote).where(and(eq(dayNote.accountId, accountId), eq(dayNote.date, date))).get()?.text ?? '';
}

/** Save the day note; an empty note removes the day's row. */
export function saveDayNote(accountId: string, date: string, text: string) {
	const t = text.slice(0, NOTE_MAX);
	if (!t.trim()) {
		db.delete(dayNote).where(and(eq(dayNote.accountId, accountId), eq(dayNote.date, date))).run();
		return;
	}
	db.insert(dayNote)
		.values({ accountId, date, text: t, updatedAt: new Date() })
		.onConflictDoUpdate({ target: [dayNote.accountId, dayNote.date], set: { text: t, updatedAt: new Date() } })
		.run();
}

export interface JournalRange {
	from: string;
	to: string;
}

/**
 * Every day in the range with something written, newest first. A day with only a scored
 * answer (a mood, no words) is kept too: the journal habit can be done with just a mood.
 */
export function loadJournal(accountId: string, range: JournalRange, opts: { today?: string } = {}): JournalDay[] {
	const days = new Map<string, JournalDay>();
	const day = (date: string) => days.get(date) ?? days.set(date, { date, items: [], moods: [], done: [] }).get(date)!;
	const inRange = (col: Parameters<typeof gte>[0]) => and(gte(col, range.from), lte(col, range.to));
	const back = encodeURIComponent('/history?notes');

	for (const n of db
		.select()
		.from(dayNote)
		.where(and(eq(dayNote.accountId, accountId), inRange(dayNote.date)))
		.all()) {
		day(n.date).items.push({
			kind: 'day',
			title: 'Day note',
			habitId: null,
			habit: null,
			text: n.text,
			href: opts.today && n.date >= opts.today ? '/' : `/day/${n.date}`
		});
	}

	const occs = db
		.select({ id: occurrence.id, date: occurrence.date, status: occurrence.status, notes: occurrence.notes, habitId: habit.id, habit: habit.name })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(and(eq(habit.accountId, accountId), inRange(occurrence.date)))
		.orderBy(asc(habit.sortOrder), asc(habit.name))
		.all();
	// Joined on the account and the dates, not passed as a list of ids: a search or the export
	// reads years of logs, more than SQLite takes as parameters.
	const byOcc = new Map<string, { taskId: string; values: Record<string, unknown> }[]>();
	if (occs.length) {
		for (const e of db
			.select({ occurrenceId: entry.occurrenceId, taskId: entry.taskId, values: entry.values })
			.from(entry)
			.innerJoin(occurrence, eq(entry.occurrenceId, occurrence.id))
			.innerJoin(habit, eq(occurrence.habitId, habit.id))
			.where(and(eq(habit.accountId, accountId), inRange(occurrence.date)))
			.orderBy(asc(entry.sortOrder))
			.all()) {
			if (e.values._summary !== true) continue;
			const list = byOcc.get(e.occurrenceId) ?? byOcc.set(e.occurrenceId, []).get(e.occurrenceId)!;
			list.push(e);
		}
	}
	const taskIds = [...new Set([...byOcc.values()].flat().map((e) => e.taskId))];
	const byTask = new Map<
		string,
		{ id: string; name: string; type: string; choices: ChoiceOption[] | null; scores: Scores | null; earlierScores: EarlierScores[] | null }[]
	>();
	if (taskIds.length) {
		for (const m of db
			.select({
				id: metric.id,
				taskId: metric.taskId,
				name: metric.name,
				type: metric.type,
				repeats: metric.repeats,
				choices: metric.choices,
				scores: metric.scores,
				earlierScores: metric.earlierScores
			})
			.from(metric)
			.innerJoin(task, eq(metric.taskId, task.id))
			.where(eq(task.accountId, accountId))
			.orderBy(asc(metric.sortOrder))
			.all()) {
			if (m.repeats || (m.type !== 'text' && m.type !== 'choice')) continue;
			const list = byTask.get(m.taskId) ?? byTask.set(m.taskId, []).get(m.taskId)!;
			list.push(m);
		}
	}

	for (const o of occs) {
		const d = day(o.date);
		if (o.status === 'done') d.done.push(o.habit);
		const href = `/log/${o.id}?back=${back}`;
		const wrote: JournalItem[] = [];
		const answers: JournalDay['moods'] = [];
		for (const e of byOcc.get(o.id) ?? []) {
			for (const m of byTask.get(e.taskId) ?? []) {
				const v = e.values[m.id];
				if (typeof v !== 'string' || !v.trim()) continue;
				if (m.type === 'text') wrote.push({ kind: 'field', title: `${o.habit} · ${m.name}`, habitId: o.habitId, habit: o.habit, text: v, href });
				// A Choice holds its option's id: the answer is the option's name and that day's number.
				else answers.push({ field: m.name, value: optionName(m.choices, v) ?? v, score: scoresOn(m.scores, m.earlierScores, o.date)[v] ?? null });
			}
		}
		if (o.notes?.trim()) wrote.push({ kind: 'log', title: `${o.habit} · Notes`, habitId: o.habitId, habit: o.habit, text: o.notes, href });
		d.items.push(...wrote);
		// Choice answers count as the day's mood when they sit with writing, or carry a number.
		d.moods.push(...answers.filter((a) => wrote.length || a.score !== null));
	}

	for (const s of db
		.select({ date: slip.date, notes: slip.notes, habitId: habit.id, habit: habit.name })
		.from(slip)
		.innerJoin(habit, eq(slip.habitId, habit.id))
		.where(and(eq(habit.accountId, accountId), inRange(slip.date), isNotNull(slip.notes)))
		.orderBy(asc(slip.createdAt))
		.all()) {
		if (!s.notes?.trim()) continue;
		day(s.date).items.push({ kind: 'slip', title: `${s.habit} · Slip`, habitId: s.habitId, habit: s.habit, text: s.notes, href: `/habits/${s.habitId}/chain` });
	}

	return [...days.values()].filter((d) => d.items.length || d.moods.length).sort((a, b) => b.date.localeCompare(a.date));
}

/** Does the account already have a habit with a long text field (a journal)? */
export function hasJournal(accountId: string): boolean {
	return !!db
		.select({ id: metric.id })
		.from(metric)
		.innerJoin(task, eq(metric.taskId, task.id))
		.where(and(eq(task.accountId, accountId), eq(metric.long, true), eq(task.archived, false)))
		.get();
}
