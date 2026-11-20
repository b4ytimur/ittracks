// What tends to come before a slip, from the optional context logged with each Slip.

export interface SlipContext {
	count: number;
	time: string | null;
	place: string | null;
	feeling: string | null;
	withWhom: string | null;
}

export interface Trigger {
	kind: 'feeling' | 'place' | 'time' | 'with';
	label: string;
	/** Share of slips with any context of this kind, 0-100. */
	percent: number;
}

/** Parts of the day for slip times. */
export function partOfDay(time: string): string {
	const h = Number(time.slice(0, 2));
	if (h < 5) return 'at night';
	if (h < 12) return 'in the morning';
	if (h < 17) return 'in the afternoon';
	if (h < 21) return 'in the evening';
	return 'late evening';
}

/**
 * The most common value of each kind of context, once there are at least `min`
 * slips with that kind recorded. Counts weigh each Slip by its count.
 */
export function topTriggers(slips: SlipContext[], min = 3): Trigger[] {
	const kinds: [Trigger['kind'], (s: SlipContext) => string | null][] = [
		['feeling', (s) => s.feeling],
		['place', (s) => s.place],
		['time', (s) => (s.time ? partOfDay(s.time) : null)],
		['with', (s) => s.withWhom]
	];
	const out: Trigger[] = [];
	for (const [kind, get] of kinds) {
		const tally = new Map<string, number>();
		let total = 0;
		for (const s of slips) {
			const v = get(s)?.trim();
			if (!v) continue;
			const key = v.toLowerCase();
			tally.set(key, (tally.get(key) ?? 0) + s.count);
			total += s.count;
		}
		if (total < min) continue;
		const [label, n] = [...tally].sort((a, b) => b[1] - a[1])[0];
		out.push({ kind, label, percent: Math.round((n / total) * 100) });
	}
	return out.sort((a, b) => b.percent - a.percent);
}
