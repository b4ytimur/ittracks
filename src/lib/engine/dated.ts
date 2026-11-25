// A value of a habit that changes from a day on, keeping what it was before: the group or routine
// it sits in (engine/tree.ts), its Area. Each earlier entry, oldest first, holds the value up to its
// `until`, inclusive; after the last one the habit's value now holds. Pure, so the server, Stats
// and the tests share it.
import { addDays, type ISODate } from './dates';

/** An earlier value under `key` (null: none), up to `until`. */
export type Earlier<K extends string> = { until: ISODate } & { [k in K]: string | null };

/** The value on a day: the earliest earlier entry that still covers it, else the value now. */
export function valueOn<K extends string>(key: K, current: string | null, earlier: Earlier<K>[] | null | undefined, date: ISODate): string | null {
	for (const e of earlier ?? []) if (date <= e.until) return e[key];
	return current;
}

/** Every value it has now or had before. */
export const valuesEver = <K extends string>(key: K, current: string | null, earlier: Earlier<K>[] | null | undefined): string[] =>
	[...new Set([current, ...(earlier ?? []).map((e) => e[key])])].filter((p): p is string => !!p);

/**
 * The earlier values after a change on `today` from `from` to `to`: `to` holds from today on, and
 * the days up to yesterday keep `from`. A habit with no past days yet keeps nothing. Changing back
 * on the same day leaves no trace, and entries that say the same thing merge. A change for past
 * days too (`applies` 'past') keeps nothing: `to` holds on every day.
 */
export function keepValue<K extends string>(
	key: K,
	earlier: Earlier<K>[] | null | undefined,
	from: string | null,
	to: string | null,
	startDate: ISODate,
	today: ISODate,
	applies: 'today' | 'past' = 'today'
): Earlier<K>[] | null {
	if (applies === 'past') return null;
	const list = [...(earlier ?? [])];
	const yesterday = addDays(today, -1);
	const last = list.at(-1)?.until;
	if (from !== to && yesterday >= startDate && (!last || last < yesterday)) list.push({ until: yesterday, [key]: from } as Earlier<K>);
	// Days the newest entries keep in the value it has now are covered by the value now.
	while (list.length && list.at(-1)![key] === to) list.pop();
	const out: Earlier<K>[] = [];
	for (const e of list) {
		if (out.length && out.at(-1)![key] === e[key]) out[out.length - 1] = e;
		else out.push(e);
	}
	return out.length ? out.slice(-50) : null;
}

/** Where a habit's Area was before a change that applies from a later day on. */
export type EarlierArea = Earlier<'areaId'>;

/** The Area a habit counted in on a day. */
export const areaOn = (h: { areaId: string | null; earlierAreas?: EarlierArea[] | null }, date: ISODate): string | null => valueOn('areaId', h.areaId, h.earlierAreas, date);
