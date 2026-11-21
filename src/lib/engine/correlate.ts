// Plain statistics for the analysis tools: a summary of numbers, Pearson and Spearman
// correlation with p-values and a confidence interval, and a straight-line fit, so an AI
// assistant (or a script) gets the math done on the server instead of in its head. The
// t distribution comes from jStat (see statistics.ts).
import { correlationCI, tP } from './statistics';

export interface Summary {
	n: number;
	sum: number | null;
	mean: number | null;
	median: number | null;
	sd: number | null;
	min: number | null;
	max: number | null;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function summarize(xs: number[]): Summary {
	const v = xs.filter((x) => Number.isFinite(x));
	const n = v.length;
	if (!n) return { n: 0, sum: null, mean: null, median: null, sd: null, min: null, max: null };
	const sum = v.reduce((a, b) => a + b, 0);
	const mean = sum / n;
	const s = [...v].sort((a, b) => a - b);
	const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
	// Sample standard deviation; one value has none.
	const sd = n > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : null;
	return { n, sum: r6(sum), mean: r6(mean), median: r6(median), sd: sd === null ? null : r6(sd), min: s[0], max: s[n - 1] };
}

export function pearson(a: number[], b: number[]): number | null {
	const n = Math.min(a.length, b.length);
	if (n < 3) return null;
	let ma = 0;
	let mb = 0;
	for (let i = 0; i < n; i++) {
		ma += a[i];
		mb += b[i];
	}
	ma /= n;
	mb /= n;
	let sab = 0;
	let saa = 0;
	let sbb = 0;
	for (let i = 0; i < n; i++) {
		const da = a[i] - ma;
		const db = b[i] - mb;
		sab += da * db;
		saa += da * da;
		sbb += db * db;
	}
	if (saa === 0 || sbb === 0) return null;
	return Math.max(-1, Math.min(1, sab / Math.sqrt(saa * sbb)));
}

/** Ranks from 1, ties sharing the average rank. */
export function ranks(xs: number[]): number[] {
	const idx = xs.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
	const out = new Array<number>(xs.length);
	for (let i = 0; i < idx.length; ) {
		let j = i;
		while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
		const r = (i + j) / 2 + 1;
		for (let k = i; k <= j; k++) out[idx[k].i] = r;
		i = j + 1;
	}
	return out;
}

/** Spearman: Pearson on ranks, so it catches any steady rise or fall, not only straight lines. */
export const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));

/** Least-squares line b = intercept + slope × a. */
export function fitLine(a: number[], b: number[]): { slope: number; intercept: number } | null {
	const n = Math.min(a.length, b.length);
	if (n < 2) return null;
	const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n;
	const mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
	let sab = 0;
	let saa = 0;
	for (let i = 0; i < n; i++) {
		sab += (a[i] - ma) * (b[i] - mb);
		saa += (a[i] - ma) ** 2;
	}
	if (saa === 0) return null;
	const slope = sab / saa;
	return { slope: r6(slope), intercept: r6(mb - slope * ma) };
}

/** Two-sided p-value that a correlation r over n pairs is really zero (t-test, n − 2 degrees of freedom). */
export function correlationP(r: number, n: number): number | null {
	if (n < 4) return null;
	if (Math.abs(r) >= 1) return 0;
	const df = n - 2;
	const t = (r * Math.sqrt(df)) / Math.sqrt(1 - r * r);
	const p = tP(t, df);
	return p === null ? null : r6(p);
}

/** Words for a correlation's size, as most textbooks use them. */
export function strength(r: number | null): 'none' | 'weak' | 'moderate' | 'strong' | 'very strong' {
	if (r === null) return 'none';
	const a = Math.abs(r);
	return a < 0.1 ? 'none' : a < 0.3 ? 'weak' : a < 0.5 ? 'moderate' : a < 0.7 ? 'strong' : 'very strong';
}

export interface Correlation {
	n: number;
	pearson: number | null;
	spearman: number | null;
	/** p-value of Pearson's r (t-test). */
	p: number | null;
	/** 95% confidence interval of Pearson's r (Fisher's z). */
	ci95: [number, number] | null;
	/** p-value of Spearman's ρ (t approximation). */
	spearmanP: number | null;
	strength: ReturnType<typeof strength>;
	direction: 'up' | 'down' | 'none';
	fit: { slope: number; intercept: number } | null;
}

/** Correlate paired values (pairs with a missing side are left out by the caller). */
export function correlate(a: number[], b: number[]): Correlation {
	const n = Math.min(a.length, b.length);
	const r = pearson(a, b);
	const rho = spearman(a, b);
	return {
		n,
		pearson: r === null ? null : r6(r),
		spearman: rho === null ? null : r6(rho),
		p: r === null ? null : correlationP(r, n),
		ci95: r === null ? null : correlationCI(r, n),
		spearmanP: rho === null ? null : correlationP(rho, n),
		strength: strength(r),
		direction: r === null || Math.abs(r) < 0.1 ? 'none' : r > 0 ? 'up' : 'down',
		fit: fitLine(a, b)
	};
}
