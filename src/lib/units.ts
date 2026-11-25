// Units are yours: kinds (Weight, Distance, or any you make) and the units in them, each worth so
// many of the kind's base. Units of one kind convert; a word that is in none is a label that never
// does. Everything that needs to know a unit reads the account's table. Nothing about one kind of
// tracking is written here: the starting table is data like any other.
import { z } from 'zod';

const word = (max: number) => z.string().trim().min(1, 'A name is missing').max(max);

export const unitSchema = z.object({
	id: z.string().max(40),
	/** How it is written, and the word a field's unit is matched by. */
	name: word(20),
	/** How many of the kind's base unit one of this is. */
	per: z.number().positive('One of it must be more than nothing').finite(),
	/** The − and + step on the log for a number in this unit. */
	step: z.number().positive('A step must be more than nothing').finite(),
	/** Other words that mean it. Matching ignores case and spaces. */
	also: z.array(z.string().max(20)).max(20).default([]),
	/** Off your list, kept for the fields that still use it. */
	off: z.boolean().optional()
});
export const unitKindSchema = z.object({
	id: z.string().max(40),
	name: word(30),
	/** The unit its totals are shown in, by name. */
	shown: z.string().max(20),
	units: z.array(unitSchema).min(1, 'A kind needs a unit').max(30),
	off: z.boolean().optional()
});
export const unitKinds = z.array(unitKindSchema).max(40);
export type Unit = z.infer<typeof unitSchema>;
export type UnitKind = z.infer<typeof unitKindSchema>;

/** The one kind that can't go: clocks need it. */
export const TIME = 'time';
/** A time is added up in minutes, and shown as hours and minutes. */
export const TIME_BASE = 'min';
const CLOCK = ['s', TIME_BASE, 'h'];

const u = (name: string, per: number, step: number, also: string[] = []): Unit => ({ id: name, name, per, step, also });
export const STARTER_KINDS: UnitKind[] = [
	{ id: TIME, name: 'Time', shown: TIME_BASE, units: [u('s', 1 / 60, 15, ['sec', 'secs', 'second', 'seconds']), u('min', 1, 5, ['mins', 'minute', 'minutes']), u('h', 60, 0.5, ['hr', 'hrs', 'hour', 'hours'])] },
	{ id: 'weight', name: 'Weight', shown: 'kg', units: [u('g', 0.001, 50, ['gram', 'grams']), u('kg', 1, 2.5, ['kgs', 'kilo', 'kilos', 'kilogram', 'kilograms']), u('lb', 0.45359237, 5, ['lbs', 'pound', 'pounds'])] },
	{ id: 'distance', name: 'Distance', shown: 'km', units: [u('m', 0.001, 100, ['meter', 'meters', 'metre', 'metres']), u('km', 1, 0.5, ['kilometer', 'kilometers', 'kilometre', 'kilometres']), u('mi', 1.609344, 0.5, ['mile', 'miles'])] }
];

type Word = string | null | undefined;
export const unitWord = (x: Word) => (x ?? '').trim().toLowerCase();

/**
 * What a unit change can do to values already logged: nothing (same unit), convert them or
 * keep their numbers (two units of one kind), or only keep their numbers (anything else).
 */
export type UnitChange = { kind: 'same' } | { kind: 'convertible'; factor: number } | { kind: 'relabel' };
/** What the user picked for past values on a unit change. */
export type UnitChoice = 'convert' | 'relabel';

export interface UnitTable {
	kinds: UnitKind[];
	/** The unit a word means, or null for a free word (or none). */
	find(x: Word): Unit | null;
	kindOf(x: Word): UnitKind | null;
	/** Two words for the same unit: "lbs" and "lb", "Pages" and "pages". */
	same(a: Word, b: Word): boolean;
	/** Can values in `a` be added to values in `b`? */
	convertible(a: Word, b: Word): boolean;
	/** How many `to` one `from` is (kg to lb: 2.2046), or null when they don't convert. */
	factor(from: Word, to: Word): number | null;
	/** A value in `from` as `to`. Units that don't convert leave the value as it is. */
	convert(v: number, from: Word, to: Word): number;
	change(from: Word, to: Word): UnitChange;
	/** The − and + step for a number in this unit, or null when the table doesn't know it. */
	stepOf(x: Word): number | null;
	/** The unit a kind is shown in, or '' when there is no such kind. */
	shown(kindId: string): string;
	isTime(x: Word): boolean;
	/** Every unit on your list, for pickers. */
	names(): string[];
}

export function unitTable(kinds: UnitKind[]): UnitTable {
	const byWord = new Map<string, { unit: Unit; kind: UnitKind }>();
	// A name beats another unit's other word, and the first of two beats the second.
	for (const pass of ['name', 'also'] as const)
		for (const kind of kinds)
			for (const unit of kind.units)
				for (const w of pass === 'name' ? [unit.name] : unit.also) if (!byWord.has(unitWord(w))) byWord.set(unitWord(w), { unit, kind });
	const at = (x: Word) => byWord.get(unitWord(x)) ?? null;
	const same = (a: Word, b: Word) => {
		const x = at(a);
		const y = at(b);
		return x && y ? x.unit === y.unit : unitWord(a) === unitWord(b);
	};
	const factor = (from: Word, to: Word) => {
		if (same(from, to)) return 1;
		const x = at(from);
		const y = at(to);
		return x && y && x.kind === y.kind ? x.unit.per / y.unit.per : null;
	};
	return {
		kinds,
		find: (x) => at(x)?.unit ?? null,
		kindOf: (x) => at(x)?.kind ?? null,
		same,
		factor,
		convertible: (a, b) => factor(a, b) !== null,
		convert: (v, from, to) => v * (factor(from, to) ?? 1),
		change: (from, to) => {
			if (same(from, to)) return { kind: 'same' };
			const f = factor(from, to);
			return f === null ? { kind: 'relabel' } : { kind: 'convertible', factor: f };
		},
		stepOf: (x) => at(x)?.unit.step ?? null,
		shown: (id) => kinds.find((k) => k.id === id)?.shown ?? '',
		isTime: (x) => at(x)?.kind.id === TIME,
		names: () => kinds.filter((k) => !k.off).flatMap((k) => k.units.filter((x) => !x.off).map((x) => x.name))
	};
}

/** The table an account starts with. */
export const STARTER = unitTable(STARTER_KINDS);

/** An account's kinds as stored. Before they were stored, the starting ones, with the weight unit it had picked. */
export function readKinds(stored: unknown, weightUnit?: string): UnitKind[] {
	const ok = unitKinds.safeParse(stored);
	if (ok.success && ok.data.some((k) => k.id === TIME)) return ok.data;
	return STARTER_KINDS.map((k) => (k.id === 'weight' && weightUnit ? { ...k, shown: STARTER.find(weightUnit)?.name ?? weightUnit } : k));
}

/** Why a table can't be, or ''. */
export function kindsProblem(kinds: UnitKind[]): string {
	const time = kinds.find((k) => k.id === TIME);
	if (!time || time.off || CLOCK.some((n) => !time.units.some((x) => x.name === n && !x.off))) return 'Time keeps s, min and h: the clocks need them';
	const names = new Map<string, string>();
	const kindNames = new Set<string>();
	for (const k of kinds) {
		if (kindNames.has(unitWord(k.name))) return `Two kinds are called “${k.name}”`;
		kindNames.add(unitWord(k.name));
		for (const x of k.units) {
			const other = names.get(unitWord(x.name));
			if (other !== undefined) return `Two units are called “${x.name}” (${other === k.name ? k.name : `${other} and ${k.name}`})`;
			names.set(unitWord(x.name), k.name);
		}
	}
	return '';
}

/** What a field's unit means: a duration with no unit is in minutes, as the log screen shows it. */
export const effectiveUnit = (m: { type: string; unit: string | null | undefined }): string => (m.unit ?? '').trim() || (m.type === 'duration' ? TIME_BASE : '');

/** Converted values keep three decimals: enough to convert back without drift (100 kg, 220.462 lb, 100 kg). */
export const roundConverted = (v: number): number => Math.round(v * 1000) / 1000;

/** `{weight}` in a unit (a Task type, a template) becomes the unit that kind is shown in. */
export const withShownUnits = (text: string, t: UnitTable): string => text.replace(/\{([a-z0-9-]+)\}/gi, (whole, id) => (t.kinds.some((k) => k.id === id) ? t.shown(id) : id === 'weight' ? '' : whole));
