// How a log runs: which row is open, what the rows still to do become when a number changes, and
// what a row says. No Svelte here, so it can be tested.

export interface RowState {
	done: boolean;
	values: Record<string, unknown>;
	/** Fields changed by hand on this row: another row never moves them. */
	own?: string[];
}
export interface RunPlace {
	key: string;
	sets: RowState[];
}
export interface Cursor {
	key: string;
	set: number;
}
export interface Field {
	id: string;
	name: string;
	type: string;
	unit: string | null;
	prefill: string;
	choices: { id: string; name: string }[] | null;
}

/** The open row: the one chosen, else the first left where you are, else the first left in the log. */
export function cursor(places: RunPlace[], at: Cursor | null, here: string | null): Cursor | null {
	if (at && places.find((p) => p.key === at.key)?.sets[at.set]) return at;
	for (const p of [...places.filter((p) => p.key === here), ...places]) {
		const set = p.sets.findIndex((s) => !s.done);
		if (set >= 0) return { key: p.key, set };
	}
	return null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
/** A number that starts from last time moves the rows still to do; one that starts from its target never does. */
export const follows = (f: Field) => f.type === 'number' && f.prefill === 'last';

/**
 * The rows still to do after row `from` was changed by hand: they move by as much as it did from
 * where it started, and take its value when there is nothing to start from. Rows done, and fields
 * changed by hand on their own row, stay.
 */
export function follow(sets: RowState[], base: RowState[], from: number, fields: Field[]): RowState[] {
	const src = sets[from];
	const ids = fields.filter((f) => follows(f) && src.own?.includes(f.id) && typeof src.values[f.id] === 'number').map((f) => f.id);
	return sets.map((s, k) => {
		if (k <= from || s.done || !ids.length) return s;
		const values = { ...s.values };
		for (const id of ids) {
			if (s.own?.includes(id)) continue;
			const v = src.values[id] as number;
			const was = base[from]?.values[id];
			const start = base[k]?.values[id];
			values[id] = typeof was === 'number' && typeof start === 'number' ? Math.max(0, round(start + v - was)) : v;
		}
		return { ...s, values };
	});
}

/** "+2.5 kg", "−1", or nothing when there is no difference to tell. */
export function difference(v: unknown, from: unknown, unit: string | null): string {
	if (typeof v !== 'number' || typeof from !== 'number' || v === from) return '';
	return `${v > from ? '+' : '−'}${round(Math.abs(v - from))}${unit ? ` ${unit}` : ''}`;
}

const isNumber = (f: Field) => f.type === 'number' || f.type === 'count' || f.type === 'duration';
export const unitOf = (f: Field) => f.unit || (f.type === 'duration' ? 'min' : '');

/** One field's value in words, or nothing when it is empty. */
export function valueText(f: Field, v: unknown): string {
	if (v === null || v === undefined || v === '' || v === false) return '';
	if (f.type === 'checkbox') return f.name;
	if (f.type === 'choice') return f.choices?.find((c) => c.id === v)?.name ?? '';
	return isNumber(f) ? `${v}${unitOf(f) ? ` ${unitOf(f)}` : ''}` : String(v);
}

/** A row's values in words: "62.5 kg × 8 · Overhand". */
export function rowText(fields: Field[], values: Record<string, unknown>): string {
	const numbers = fields.filter(isNumber).map((f) => valueText(f, values[f.id])).filter(Boolean);
	const rest = fields.filter((f) => !isNumber(f)).map((f) => valueText(f, values[f.id])).filter(Boolean);
	return [numbers.join(' × '), ...rest].filter(Boolean).join(' · ');
}

/** Several rows in words: "62.5 kg × 8, 8, 7" while only the last number differs, else each row. */
export function rowsText(fields: Field[], rows: RowState[]): string {
	if (rows.length < 2) return rows.map((r) => rowText(fields, r.values)).join('');
	const numbers = fields.filter(isNumber);
	const last = numbers.at(-1);
	const texts = rows.map((r) => rowText(fields, r.values));
	if (new Set(texts).size === 1) return `${rows.length} × ${texts[0]}`;
	if (last) {
		const head = (r: RowState) => rowText(fields, { ...r.values, [last.id]: null });
		if (new Set(rows.map(head)).size === 1 && rows.every((r) => r.values[last.id] != null)) {
			const before = numbers.slice(0, -1).map((f) => valueText(f, rows[0].values[f.id])).filter(Boolean);
			const list = rows.map((r) => valueText({ ...last, unit: null, type: 'count' }, r.values[last.id])).join(', ');
			return [...before, list + (unitOf(last) ? ` ${unitOf(last)}` : '')].join(' × ');
		}
	}
	return texts.join(', ');
}

/** Which of the rows above were done: "Set 1", "Sets 1–2", "Sets 1, 3 · set 2 not done". */
export function rowsName(rows: RowState[], one: string, many: string): string {
	const done = rows.flatMap((r, i) => (r.done ? [i + 1] : []));
	if (!done.length) return '';
	const last = done.at(-1)!;
	const skipped = rows.slice(0, last).flatMap((r, i) => (r.done ? [] : [i + 1]));
	const name = done.length === 1 ? `${cap(one)} ${last}` : !skipped.length ? `${cap(many)} 1–${last}` : `${cap(many)} ${done.join(', ')}`;
	return name;
}
export const skippedName = (rows: RowState[], one: string): string => {
	const last = rows.reduce((n, r, i) => (r.done ? i : n), -1);
	const skipped = rows.slice(0, Math.max(0, last)).flatMap((r, i) => (r.done ? [] : [i + 1]));
	return skipped.length ? `${one} ${skipped.join(', ')} not done` : '';
};
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
