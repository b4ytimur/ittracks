// The usual way to log a habit that has Tasks: the one control Today and a past day's page show
// on its row. Both pages ask this, so they can't drift apart. Pure, so the tests share the rule.

export type Usual = 'resume' | 'done' | 'same' | 'log';

export interface UsualOf {
	/** Started on the log screen and saved, not finished yet. */
	inProgress?: boolean;
	/** One-tap Done is on: the person asked for Done to log the targets. */
	quickDone: boolean;
	/** "Same as last" has something to repeat (canRepeat in src/lib/server/today.ts). */
	canRepeat: boolean;
}

/** What you asked for comes before a guess from history: One-tap Done wins over Same as last. */
export function usualWay(it: UsualOf): Usual {
	if (it.inProgress) return 'resume';
	if (it.quickDone) return 'done';
	if (it.canRepeat) return 'same';
	return 'log';
}
