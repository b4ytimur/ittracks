// The chain view: each day of a habit as a cell, with misses the streak rule forgave
// marked apart from misses that broke the streak.
import { addDays, weekStart, type ISODate } from './dates';
import type { Level, Mark, StreakRule } from './streak';

export type Cell =
	| { kind: 'done'; level: Level }
	| { kind: 'skipped' }
	| { kind: 'missed'; forgiven: boolean }
	| { kind: 'due' }
	| { kind: 'rest' }
	| { kind: 'future' };

/** Which missed dates the rule forgives. Marks sorted oldest first. */
export function forgivenMisses(marks: Mark[], rule: StreakRule): Set<ISODate> {
	const acted = marks.filter((m) => m.status !== 'due');
	const out = new Set<ISODate>();
	if (rule.kind === 'neverTwice') {
		acted.forEach((m, i) => {
			if (m.status !== 'missed') return;
			const before = acted[i - 1]?.status === 'missed';
			const after = acted[i + 1]?.status === 'missed';
			if (!before && !after) out.add(m.date);
		});
	} else if (rule.kind === 'grace') {
		const bucket = (d: ISODate) => (rule.period === 'week' ? weekStart(d) : d.slice(0, 7));
		const used = new Map<string, number>();
		for (const m of acted) {
			if (m.status !== 'missed') continue;
			const n = (used.get(bucket(m.date)) ?? 0) + 1;
			used.set(bucket(m.date), n);
			if (n <= rule.misses) out.add(m.date);
		}
	}
	return out;
}

/** One cell per day from `from` to `to`, inclusive. Days with no Occurrence are rest days. */
export function chainCells(
	marks: Mark[],
	rule: StreakRule,
	from: ISODate,
	to: ISODate,
	today: ISODate
): { date: ISODate; cell: Cell }[] {
	const byDate = new Map(marks.map((m) => [m.date, m]));
	const forgiven = forgivenMisses(marks, rule);
	const out: { date: ISODate; cell: Cell }[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) {
		const m = byDate.get(d);
		let cell: Cell;
		if (d > today) cell = { kind: 'future' };
		else if (!m) cell = { kind: 'rest' };
		else if (m.status === 'done') cell = { kind: 'done', level: m.level ?? 'target' };
		else if (m.status === 'skipped') cell = { kind: 'skipped' };
		else if (m.status === 'missed') cell = { kind: 'missed', forgiven: forgiven.has(d) };
		else cell = { kind: 'due' };
		out.push({ date: d, cell });
	}
	return out;
}
