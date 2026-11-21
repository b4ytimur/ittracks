// The journal on the server: day notes, and the feed of everything written per day (journal
// fields, log notes, slip notes, the day note). Private: nothing here is ever exported as a
// template or shared; only the owner's Markdown export reads it.
import { and, asc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { db } from './db';
import { dayNote, entry, habit, metric, occurrence, slip } from './db/schema';
import { NOTE_MAX } from '$lib/forms';
import type { JournalDay, JournalItem } from '$lib/journal';

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
	const back = encodeURIComponent('/journal');

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
	const entries = occs.length
		? db
				.select({ occurrenceId: entry.occurrenceId, taskId: entry.taskId, values: entry.values })
				.from(entry)
				.where(inArray(entry.occurrenceId, occs.map((o) => o.id)))
				.orderBy(asc(entry.sortOrder))
				.all()
		: [];
	const metrics = entries.length
		? db
				.select({ id: metric.id, taskId: metric.taskId, name: metric.name, type: metric.type, repeats: metric.repeats, scores: metric.scores })
				.from(metric)
				.where(inArray(metric.taskId, [...new Set(entries.map((e) => e.taskId))]))
				.orderBy(asc(metric.sortOrder))
				.all()
				.filter((m) => !m.repeats && (m.type === 'text' || m.type === 'choice'))
		: [];

	for (const o of occs) {
		const d = day(o.date);
		if (o.status === 'done') d.done.push(o.habit);
		const href = `/log/${o.id}?back=${back}`;
		const wrote: JournalItem[] = [];
		const answers: JournalDay['moods'] = [];
		for (const e of entries.filter((x) => x.occurrenceId === o.id && x.values._summary === true)) {
			for (const m of metrics.filter((x) => x.taskId === e.taskId)) {
				const v = e.values[m.id];
				if (typeof v !== 'string' || !v.trim()) continue;
				if (m.type === 'text') wrote.push({ kind: 'field', title: `${o.habit} · ${m.name}`, habitId: o.habitId, habit: o.habit, text: v, href });
				else answers.push({ field: m.name, value: v, score: typeof m.scores?.[v] === 'number' ? m.scores[v] : null });
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

/** The first day anything was written, to know whether "Show older" has more. */
export function firstJournalDate(accountId: string): string | null {
	const n = db.select({ date: dayNote.date }).from(dayNote).where(eq(dayNote.accountId, accountId)).orderBy(asc(dayNote.date)).limit(1).get();
	const o = db
		.select({ date: occurrence.date })
		.from(occurrence)
		.innerJoin(habit, eq(occurrence.habitId, habit.id))
		.where(eq(habit.accountId, accountId))
		.orderBy(asc(occurrence.date))
		.limit(1)
		.get();
	return [n?.date, o?.date].filter((x): x is string => !!x).sort()[0] ?? null;
}
