// The "last value" headline: what a habit or tracker logged last in its main field,
// and for a number how far it moved in a week: "82.4 kg · −0.6 kg in a week". Pure, so Today, the
// Habits list and the MCP server say it the same way.
import { addDays, daysBetween, type ISODate } from './dates';

export interface LastPoint {
	date: ISODate;
	value: number | string;
}

export interface Last {
	date: ISODate;
	value: number | string;
	/** The number now minus the latest one logged a week or more before it; null without one. */
	change: number | null;
}

/** The latest point, and for a number its change since the latest point at least `days` before it. */
export function lastOf(points: readonly LastPoint[], days = 7): Last | null {
	const sorted = [...points].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
	const latest = sorted[0];
	if (!latest) return null;
	if (typeof latest.value !== 'number') return { ...latest, change: null };
	const cutoff = addDays(latest.date, -days);
	const before = sorted.find((p) => p.date <= cutoff && typeof p.value === 'number');
	const change = before ? Math.round(((latest.value as number) - (before.value as number)) * 1000) / 1000 : null;
	return { ...latest, change };
}

/** When it was logged, said for a line: nothing for today, "yesterday", "3 days ago", "12 Oct". */
export function whenText(date: ISODate, today: ISODate): string {
	const n = daysBetween(date, today);
	if (n <= 0) return '';
	if (n === 1) return 'yesterday';
	if (n < 14) return `${n} days ago`;
	return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * The headline: the value as `say` writes it, when it was logged unless today, and the change in a
 * week with its sign ("+0.4 kg in a week"); no change line for words like a mood.
 */
export function lastText(l: Last, today: ISODate, say: (v: number | string) => string): string {
	const when = whenText(l.date, today);
	const head = `${say(l.value)}${when ? `, ${when}` : ''}`;
	if (l.change === null) return head;
	const sign = l.change > 0 ? '+' : l.change < 0 ? '−' : '±';
	return `${head} · ${sign}${say(Math.abs(l.change))} in a week`;
}
