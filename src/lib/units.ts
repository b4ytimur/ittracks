// The unit registry: every unit the app can convert, as data. The Task editor, the log
// screen's +/- step, Stats and the "convert or relabel" choice on a unit change all read
// this one table. A unit that isn't listed (pages, glasses, reps) is still allowed: it is
// its own kind and never converts. New unit: add a row here; nothing else changes.

/** A kind of quantity. Units convert only within one: kg to lb, never kg to km. */
export type Dimension = 'time' | 'mass' | 'distance';

export interface Unit {
	/** How it is written by default, and the key it is matched by. */
	key: string;
	dimension: Dimension;
	/** How many of the dimension's base unit one of this is (base: min, kg, km). */
	toBase: number;
	/** Default +/- step on the log screen for a number in this unit. */
	step: number;
	/** Other spellings that mean the same unit. Matching ignores case and spaces. */
	aliases: string[];
}

export const DIMENSIONS: Record<Dimension, { label: string; base: string }> = {
	time: { label: 'Time', base: 'min' },
	mass: { label: 'Weight', base: 'kg' },
	distance: { label: 'Distance', base: 'km' }
};

export const UNITS: readonly Unit[] = [
	{ key: 's', dimension: 'time', toBase: 1 / 60, step: 15, aliases: ['sec', 'secs', 'second', 'seconds'] },
	{ key: 'min', dimension: 'time', toBase: 1, step: 5, aliases: ['mins', 'minute', 'minutes'] },
	{ key: 'h', dimension: 'time', toBase: 60, step: 0.5, aliases: ['hr', 'hrs', 'hour', 'hours'] },
	{ key: 'g', dimension: 'mass', toBase: 0.001, step: 50, aliases: ['gram', 'grams'] },
	{ key: 'kg', dimension: 'mass', toBase: 1, step: 2.5, aliases: ['kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'] },
	{ key: 'lb', dimension: 'mass', toBase: 0.45359237, step: 5, aliases: ['lbs', 'pound', 'pounds'] },
	{ key: 'm', dimension: 'distance', toBase: 0.001, step: 100, aliases: ['meter', 'meters', 'metre', 'metres'] },
	{ key: 'km', dimension: 'distance', toBase: 1, step: 0.5, aliases: ['kilometer', 'kilometers', 'kilometre', 'kilometres'] },
	{ key: 'mi', dimension: 'distance', toBase: 1.609344, step: 0.5, aliases: ['mile', 'miles'] }
];

const norm = (u: string | null | undefined) => (u ?? '').trim().toLowerCase();
const BY_NAME = new Map(UNITS.flatMap((u) => [u.key, ...u.aliases].map((n) => [n, u] as const)));

/** The registry's unit for what a user typed, or null for a free-text unit (or none). */
export const findUnit = (u: string | null | undefined): Unit | null => BY_NAME.get(norm(u)) ?? null;

/** Units of one dimension, for pickers and suggestions. */
export const unitsOf = (d: Dimension): Unit[] => UNITS.filter((u) => u.dimension === d);

/** What a field's unit means: a duration with no unit is in minutes, as the log screen shows it. */
export const effectiveUnit = (m: { type: string; unit: string | null | undefined }): string =>
	(m.unit ?? '').trim() || (m.type === 'duration' ? 'min' : '');

/** Two spellings of the same unit: "lbs" and "lb", "Pages" and "pages". */
export function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
	const x = findUnit(a);
	const y = findUnit(b);
	return x && y ? x === y : norm(a) === norm(b);
}

/** Can values in `a` be added to values in `b`? The same unit, or two units of one dimension. */
export function convertible(a: string | null | undefined, b: string | null | undefined): boolean {
	if (sameUnit(a, b)) return true;
	const x = findUnit(a);
	const y = findUnit(b);
	return !!x && !!y && x.dimension === y.dimension;
}

/** How many `to` one `from` is (kg to lb: 2.2046), or null when they don't convert. */
export function factor(from: string | null | undefined, to: string | null | undefined): number | null {
	if (sameUnit(from, to)) return 1;
	const x = findUnit(from);
	const y = findUnit(to);
	return x && y && x.dimension === y.dimension ? x.toBase / y.toBase : null;
}

/** A value in `from` as `to`. Units that don't convert leave the value as it is. */
export const convert = (v: number, from: string | null | undefined, to: string | null | undefined): number => v * (factor(from, to) ?? 1);

/** Converted values keep three decimals: enough to convert back without drift (100 kg, 220.462 lb, 100 kg). */
export const roundConverted = (v: number): number => Math.round(v * 1000) / 1000;

/** Default +/- step for a number in this unit, or null when the registry doesn't know it. */
export const stepOf = (u: string | null | undefined): number | null => findUnit(u)?.step ?? null;

/**
 * What a unit change can do to values already logged: nothing (same unit), convert them or
 * keep their numbers (two units of one dimension), or only keep their numbers (anything else).
 */
export type UnitChange =
	| { kind: 'same' }
	| { kind: 'convertible'; factor: number }
	| { kind: 'relabel' };

export function unitChange(from: string | null | undefined, to: string | null | undefined): UnitChange {
	if (sameUnit(from, to)) return { kind: 'same' };
	const f = factor(from, to);
	return f === null ? { kind: 'relabel' } : { kind: 'convertible', factor: f };
}

/** What the user picked for past values on a unit change. */
export type UnitChoice = 'convert' | 'relabel';
