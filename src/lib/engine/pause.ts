// Pauses and vacations: paused days are not due and never count as misses.
import type { ISODate } from './dates';

export interface Pause {
	/** null pauses every habit. */
	habitId: string | null;
	start: ISODate;
	end: ISODate;
}

/** The pause covering a habit on a date, if any. */
export function pauseOn(pauses: Pause[], habitId: string, date: ISODate): Pause | null {
	return (
		pauses.find((p) => (p.habitId === null || p.habitId === habitId) && p.start <= date && date <= p.end) ?? null
	);
}

/** Is a date paused for this habit? */
export const isPaused = (pauses: Pause[], habitId: string, date: ISODate) => !!pauseOn(pauses, habitId, date);
