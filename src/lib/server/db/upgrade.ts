// Rows written before a data shape changed, brought up to date. Runs on startup after the
// migrations, and after an import, since an export made by an older version brings the old
// shapes with it. Each step only touches rows still in the old shape, so running it again
// changes nothing.
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '.';
import { entry, habit, metric, slip } from './schema';
import { defaultTriggers } from '../../forms';
import type { ChoiceOption } from '../../options';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The id a word stands for in a list of options. A word no option has any more (renamed or
 * removed before ids existed) is added as an archived option, so the logs holding it read again.
 */
function idIn(options: ChoiceOption[]): (word: string) => string {
	return (word) => {
		// A value that already holds an id (written by the new code) stays as it is.
		const o = options.find((x) => x.id === word) ?? options.find((x) => x.name === word) ?? options.find((x) => norm(x.name) === norm(word));
		if (o) return o.id;
		const kept: ChoiceOption = { id: crypto.randomUUID(), name: word.slice(0, 40), archived: true };
		options.push(kept);
		return kept.id;
	};
}

/** Options with ids from an old list of words, one per word. */
const fromWords = (words: unknown[]): ChoiceOption[] =>
	words.reduce<ChoiceOption[]>((out, w) => (typeof w === 'string' && w.trim() && !out.some((o) => o.name === w) ? [...out, { id: crypto.randomUUID(), name: w }] : out), []);

/**
 * Choice options and slip feelings (migration 0010): from words to options with ids. A Choice
 * field's logged values and numbers, and a break habit's slips, move from the word to the id.
 * A break habit that used the default feelings gets them as its own list.
 */
export function upgradeOptionIds(q: Db = db): { metrics: number; habits: number } {
	const metrics = q
		.select({ id: metric.id, taskId: metric.taskId, type: metric.type, choices: metric.choices, scores: metric.scores })
		.from(metric)
		.where(and(isNotNull(metric.choices), sql`json_type(${metric.choices}, '$[0]') = 'text'`))
		.all();
	for (const m of metrics) {
		const options = fromWords(m.choices as unknown[]);
		const idOf = idIn(options);
		if (m.type === 'choice')
			for (const e of q.select({ id: entry.id, values: entry.values }).from(entry).where(eq(entry.taskId, m.taskId)).all()) {
				const v = e.values?.[m.id];
				if (typeof v === 'string' && v) q.update(entry).set({ values: { ...e.values, [m.id]: idOf(v) } }).where(eq(entry.id, e.id)).run();
			}
		const scores = Object.fromEntries(
			Object.entries((m.scores ?? {}) as Record<string, unknown>)
				.filter(([word, n]) => typeof n === 'number' && options.some((o) => !o.archived && o.name === word))
				.map(([word, n]) => [idOf(word), n as number])
		);
		q.update(metric)
			.set({ choices: options, scores: Object.keys(scores).length ? scores : null })
			.where(eq(metric.id, m.id))
			.run();
	}

	const habits = q
		.select({ id: habit.id, triggers: habit.triggers })
		.from(habit)
		.where(
			or(
				and(eq(habit.direction, 'break'), isNull(habit.triggers)),
				and(isNotNull(habit.triggers), sql`json_type(${habit.triggers}, '$[0]') = 'text'`),
				// Every feeling removed, while old slips still hold their words.
				and(sql`json_array_length(${habit.triggers}) = 0`, sql`exists (select 1 from ${slip} where ${slip.habitId} = ${habit.id} and ${slip.feeling} is not null)`)
			)
		)
		.all();
	for (const h of habits) {
		const options = h.triggers ? fromWords(h.triggers as unknown[]) : defaultTriggers();
		const find = idIn(options);
		for (const s of q.select({ id: slip.id, feeling: slip.feeling }).from(slip).where(and(eq(slip.habitId, h.id), isNotNull(slip.feeling))).all())
			if (s.feeling) q.update(slip).set({ feeling: find(s.feeling) }).where(eq(slip.id, s.id)).run();
		q.update(habit).set({ triggers: options }).where(eq(habit.id, h.id)).run();
	}
	return { metrics: metrics.length, habits: habits.length };
}
