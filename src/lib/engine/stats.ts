import { addDays, weekStart, type ISODate } from './dates';

export interface Mark {
	date: ISODate;
	status: string;
}

export interface HabitStats {
	/** Done ÷ scheduled over the last 30 days, 0 to 100. Skips don't count against you; today counts only once done. Null with nothing scheduled yet. */
	consistency: number | null;
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
		if (m.status === 'done') done++;
	}
	return { consistency: scheduled ? Math.round((done / scheduled) * 100) : null, week, total, lastDone };
}

/** The headline line for a habit on Today. */
export function headlineText(kind: string, s: HabitStats, streak: string): string {
	switch (kind) {
		case 'streak':
			return streak;
		case 'consistency':
			return s.consistency === null ? '' : `${s.consistency}% in 30 days`;
		case 'week':
			return `${s.week} done this week`;
		case 'total':
			return `${s.total} done in total`;
		default:
			return '';
	}
}
