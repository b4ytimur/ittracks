import { addDays, daysBetween, weekStart, type ISODate } from './dates';

export interface Mark {
	date: ISODate;
	status: string;
}

export interface HabitStats {
	/** Done ÷ scheduled over the last 30 days, 0 to 100. Skips don't count against you; today counts only once done. Null with nothing scheduled yet. */
	consistency: number | null;
	/** How many of those days it covers: from its first day in them to today (fewer than 30 for a habit or group that is newer). */
	days: number;
	/** Done since Monday. */
	week: number;
	/** Done, ever. */
	total: number;
	lastDone: ISODate | null;
}

export function habitStats(marks: Mark[], today: ISODate, days = 30): HabitStats {
	const from = addDays(today, -(days - 1));
	const monday = weekStart(today);
	let done = 0;
	let scheduled = 0;
	let week = 0;
	let total = 0;
	let lastDone: ISODate | null = null;
	let first: ISODate | null = null;
	for (const m of marks) {
		if (m.date > today) continue;
		if (m.status === 'done') {
			total++;
			if (!lastDone || m.date > lastDone) lastDone = m.date;
			if (m.date >= monday) week++;
		}
		if (m.date < from || m.status === 'skipped') continue;
		if (m.date === today && m.status === 'due') continue;
		scheduled++;
		if (!first || m.date < first) first = m.date;
		if (m.status === 'done') done++;
	}
	return { consistency: scheduled ? Math.round((done / scheduled) * 100) : null, days: first ? daysBetween(first, today) + 1 : 0, week, total, lastDone };
}

/** "86% in 30 days", or over the days it has: a group made yesterday never claims a month. */
export const consistencyText = (s: Pick<HabitStats, 'consistency' | 'days'>): string =>
	s.consistency === null ? '' : `${s.consistency}% in ${s.days} ${s.days === 1 ? 'day' : 'days'}`;

/**
 * The headline line for a habit on Today. `last` is what its main field logged last (server/last-value.ts).
 * A tracker's logs are records, so they read "logged", and it has no streak or consistency to show.
 */
export function headlineText(kind: string, s: HabitStats, streak: string, opts: { last?: string | null; tracker?: boolean } = {}): string {
	const did = opts.tracker ? 'logged' : 'done';
	switch (kind) {
		case 'streak':
			return opts.tracker ? '' : streak;
		case 'consistency':
			return opts.tracker ? '' : consistencyText(s);
		case 'week':
			return `${s.week} ${did} this week`;
		case 'total':
			return `${s.total} ${did} in total`;
		case 'last':
			return opts.last ?? '';
		default:
			return '';
	}
}

/** Which headline a habit shows: its own pick, else a tracker's last value, else the default for all habits. */
export const headlineKind = (own: string | undefined, all: string, tracker: boolean): string => own ?? (tracker ? 'last' : all);
