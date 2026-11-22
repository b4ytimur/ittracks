// What a bulk change does, item by item: the preview before it runs and the answer after.
// Items it can't change are listed with the reason, never changed silently.

export interface Line {
	id: string;
	label: string;
	/** What changes for it: "3 days: Mon 16, Tue 17, Wed 18", "kg → lb, 412 values converted". */
	detail?: string;
}

export interface Report {
	/** One line for a toast: "Skipped 9 days of 3 habits". */
	summary: string;
	/** How many items change. */
	count: number;
	changes: Line[];
	/** Items left as they are, grouped by why. */
	skipped: { reason: string; items: Line[] }[];
	/** Things about the whole change: "Days after today are left out". */
	notes: string[];
}

export class Reporter {
	private changes: Line[] = [];
	private skipped = new Map<string, Line[]>();
	private notes: string[] = [];
	private headline: string | null = null;

	change(line: Line) {
		this.changes.push(line);
	}

	/** How many items change so far. */
	get count() {
		return this.changes.length;
	}

	skip(reason: string, line: Line) {
		this.skipped.set(reason, [...(this.skipped.get(reason) ?? []), line]);
	}

	note(text: string) {
		if (!this.notes.includes(text)) this.notes.push(text);
	}

	/** The toast's line, when the action can say it better than the default. */
	summary(text: string) {
		this.headline = text;
	}

	build(fallback: (count: number) => string): Report {
		return {
			summary: this.headline ?? fallback(this.changes.length),
			count: this.changes.length,
			changes: this.changes,
			skipped: [...this.skipped].map(([reason, items]) => ({ reason, items })),
			notes: this.notes
		};
	}
}

/** "Mon 16 Nov" for a date. */
export const dayLabel = (d: string) =>
	new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Dates as a short list: "Mon 16 Nov, Tue 17 Nov" or "Mon 16 Nov to Sun 22 Nov (7 days)". */
export function dayList(dates: string[]): string {
	if (dates.length <= 3) return dates.map(dayLabel).join(', ');
	return `${dayLabel(dates[0])} to ${dayLabel(dates[dates.length - 1])} (${dates.length} days)`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
