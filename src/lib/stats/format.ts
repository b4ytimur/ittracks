// How stats numbers read: 1,284 · 12.9K · 2 h 5 min · 75% · €198.
import type { ValueKind } from './engine';

const nf = (max: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: max });
const digits = (v: number) => (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);

/** A plain number with sensible decimals. */
export function num(v: number): string {
	return nf(digits(v)).format(v);
}

/** Short form for axes: 950, 1,284, 12.9K, 4.2M. */
export function compact(v: number): string {
	const a = Math.abs(v);
	if (a >= 1e6) return `${nf(1).format(v / 1e6)}M`;
	if (a >= 1e4) return `${nf(1).format(v / 1e3)}K`;
	return num(v);
}

/** Minutes as "45 min" or "2 h 5 min"; short times keep their seconds: "45 s", "1 min 30 s". */
export function duration(min: number): string {
	const neg = min < 0;
	const secs = Math.round(Math.abs(min) * 60);
	let out: string;
	if (secs < 600 && secs % 60 !== 0) out = secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`;
	else {
		const m = Math.round(Math.abs(min));
		const h = Math.floor(m / 60);
		out = h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
	}
	return neg ? `−${out}` : out;
}

const isSymbol = (u: string) => /^[^\p{L}\p{N}\s]{1,3}$/u.test(u);

/** A value with its unit, the way a card shows it. */
export function value(v: number | null | undefined, unit: string, kind: ValueKind, opts: { short?: boolean } = {}): string {
	if (v === null || v === undefined || !Number.isFinite(v)) return '–';
	if (kind === 'percent') return `${nf(Math.abs(v) < 10 ? 1 : 0).format(v)}%`;
	if (kind === 'duration' && (unit === 'min' || unit === '')) return duration(v);
	const n = opts.short ? compact(v) : num(v);
	if (!unit) return n;
	if (v === 1 && ['times', 'sets', 'slips', 'days', 'logs'].includes(unit)) unit = unit.slice(0, -1);
	if (isSymbol(unit)) return v < 0 ? `−${unit}${n.replace('-', '')}` : `${unit}${n}`;
	return `${n} ${unit}`;
}

/** Axis tick text: no unit except %, and durations in hours once they're long. */
export function tick(v: number, unit: string, kind: ValueKind, max: number): string {
	if (kind === 'percent') return `${compact(v)}%`;
	if (kind === 'duration' && max >= 180) return `${compact(v / 60)} h`;
	return compact(v);
}

/** The name of the period a card compares with. */
export function previousName(range: string): string {
	if (range === 'week') return 'last week';
	if (range === 'month') return 'last month';
	if (range === 'year') return 'last year';
	if (range === '7d') return 'the 7 days before';
	if (range === '30d') return 'the 30 days before';
	if (range === '90d') return 'the 90 days before';
	if (range === '12m') return 'the 12 months before';
	return 'the period before';
}

/** "+3 vs last week", and whether that is good news. */
export function delta(cur: number | null, prev: number | null, unit: string, kind: ValueKind, upIsGood: boolean, range: string): { text: string; good: boolean | null } | null {
	if (cur === null || prev === null) return null;
	const d = cur - prev;
	const name = previousName(range);
	if (Math.abs(d) < 1e-9) return { text: `Same as ${name}`, good: null };
	const sign = d > 0 ? '+' : '−';
	const body = kind === 'percent' ? `${nf(1).format(Math.abs(d))} pts` : value(Math.abs(d), unit, kind);
	return { text: `${sign}${body} vs ${name}`, good: d > 0 === upIsGood };
}

/** Round numbers for an axis: 0, 50, 100, 150. */
export function niceTicks(min: number, max: number, count = 4): number[] {
	if (min === max) {
		if (max === 0) return [0, 1];
		min = Math.min(0, min);
		max = max > 0 ? max : 0;
	}
	const span = max - min;
	const raw = span / count;
	const mag = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
	const lo = Math.floor(min / step) * step;
	const hi = Math.ceil(max / step) * step;
	const out: number[] = [];
	for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
	return out;
}

export const seriesColor = (i: number, key: string) => (key === 'other' ? 'var(--ink-muted)' : `var(--series-${(i % 8) + 1})`);

/** One of five steps of the amount ramp, 0 for nothing. */
export function step(v: number | null, max: number): number {
	if (v === null || v <= 0 || max <= 0) return 0;
	return Math.min(5, Math.max(1, Math.ceil((v / max) * 5)));
}

export const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const shortDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
