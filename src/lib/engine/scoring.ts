// How a build habit's days are judged. A habit is done, skipped or missed, with a
// streak. A tracker only keeps what you log (weight, mood, sleep, money spent): nothing it logs is
// done or missed, so it never counts toward streaks, consistency, the day's count or a group.
// One setting read through `counts`, so every place that counts asks the same question.

export const SCORINGS = ['habit', 'track'] as const;
export type Scoring = (typeof SCORINGS)[number];

/** Does this habit's day count toward streaks, consistency, done counts and groups? Break habits count slips. */
export const counts = (h: { scoring?: string | null }): boolean => h.scoring !== 'track';

/** A tracker: logs are records, never done or missed. */
export const isTracker = (h: { direction?: string; scoring?: string | null }): boolean => h.scoring === 'track' && h.direction !== 'break';

/** What a second number logged the same day does to the first: adds to it (glasses, coffees) or replaces it (weight). */
export const SAME_DAY = ['add', 'replace'] as const;
export type SameDay = (typeof SAME_DAY)[number];
