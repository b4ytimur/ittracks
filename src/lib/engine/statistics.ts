// Statistical tests for the analysis tools, so an AI assistant gets real statistics from the
// server instead of guessing: descriptive statistics, trend (least squares with a confidence
// interval, and Mann-Kendall with Sen's slope), a change point with a permutation p-value,
// before/after comparisons (Welch's t-test, Mann-Whitney U, and for yes/no data two
// proportions with Fisher's exact test), group differences (Kruskal-Wallis and one-way
// ANOVA, with each group against the rest) and unusual values (modified z-scores).
//
// Descriptives come from simple-statistics and distributions from jStat, both well tested;
// the tests are the textbook formulas on top of them, checked against R in statistics.test.ts.
// Every result says which method it used, n, an effect size with words for its size, and
// a p-value, so a caller can't mistake a small, noisy sample for a finding.
import jStat from 'jstat';
import {
	mean,
	median,
	medianAbsoluteDeviation,
	quantileSorted,
	sampleKurtosis,
	sampleSkewness,
	sampleStandardDeviation,
	sampleVariance
} from 'simple-statistics';

/** Four significant digits: enough for statistics, short for an assistant to read. */
export const sig = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toPrecision(4)));
const sigPair = (a: number, b: number): [number, number] | null => (Number.isFinite(a) && Number.isFinite(b) ? [sig(a)!, sig(b)!] : null);

// ---------- distributions ----------

/** The smallest p-value reported: below this, floating point can't tell the difference. */
const TINY = 1e-16;

/** Two-sided p-value of a t statistic. */
export const tP = (t: number, df: number) => (df > 0 && Number.isFinite(t) ? Math.min(1, Math.max(TINY, jStat.ibeta(df / (df + t * t), df / 2, 0.5))) : null);
/** The t value that leaves 2.5% in each tail. */
export const t975 = (df: number) => jStat.studentt.inv(0.975, df);
/** Two-sided p-value of a standard normal z. */
export const zP = (z: number) => (Number.isFinite(z) ? Math.min(1, Math.max(TINY, 2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1)))) : null);
const chiP = (x: number, df: number) => (df > 0 && Number.isFinite(x) ? Math.max(TINY, 1 - jStat.chisquare.cdf(x, df)) : null);
const fP = (f: number, d1: number, d2: number) => (d1 > 0 && d2 > 0 && Number.isFinite(f) ? Math.max(TINY, 1 - jStat.centralF.cdf(f, d1, d2)) : null);

/** Ranks from 1, ties sharing the average rank, and the sizes of the tie groups. */
export function rankTies(xs: number[]): { ranks: number[]; ties: number[] } {
	const idx = xs.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
	const ranks = new Array<number>(xs.length);
	const ties: number[] = [];
	for (let i = 0; i < idx.length; ) {
		let j = i;
		while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
		for (let k = i; k <= j; k++) ranks[idx[k].i] = (i + j + 2) / 2;
		if (j > i) ties.push(j - i + 1);
		i = j + 1;
	}
	return { ranks, ties };
}

// ---------- words for sizes ----------

export type Size = 'negligible' | 'small' | 'medium' | 'large';
/** Cohen's conventions for d and g. */
export const sizeOfD = (d: number | null): Size | null => (d === null ? null : Math.abs(d) < 0.2 ? 'negligible' : Math.abs(d) < 0.5 ? 'small' : Math.abs(d) < 0.8 ? 'medium' : 'large');
/** For r, rank-biserial r and Kendall's τ. */
export const sizeOfR = (r: number | null): Size | null => (r === null ? null : Math.abs(r) < 0.1 ? 'negligible' : Math.abs(r) < 0.3 ? 'small' : Math.abs(r) < 0.5 ? 'medium' : 'large');
/** For η² and ε² (share of variance explained). */
export const sizeOfEta = (e: number | null): Size | null => (e === null ? null : e < 0.01 ? 'negligible' : e < 0.06 ? 'small' : e < 0.14 ? 'medium' : 'large');
/** Cohen's h for two proportions. */
export const sizeOfH = sizeOfD;

// ---------- descriptives ----------

export interface Descriptives {
	n: number;
	mean: number | null;
	sd: number | null;
	/** Standard error of the mean. */
	se: number | null;
	/** 95% confidence interval of the mean (t distribution). */
	meanCI95: [number, number] | null;
	median: number | null;
	q1: number | null;
	q3: number | null;
	iqr: number | null;
	min: number | null;
	max: number | null;
	/** Median absolute deviation, a spread that ignores outliers. */
	mad: number | null;
	/** Coefficient of variation: sd ÷ mean. */
	cv: number | null;
	skewness: number | null;
	/** Excess kurtosis (0 for a normal distribution). */
	kurtosis: number | null;
	/** Values beyond 1.5 × IQR from the quartiles (Tukey's fences), as indexes. */
	outliers: number[];
	/** Only 0s and 1s, such as done/missed: averages are rates. */
	binary: boolean;
}

export function describeSample(raw: number[]): Descriptives {
	const xs = raw.filter((x) => Number.isFinite(x));
	const n = xs.length;
	const binary = n > 0 && xs.every((x) => x === 0 || x === 1);
	if (!n)
		return { n, mean: null, sd: null, se: null, meanCI95: null, median: null, q1: null, q3: null, iqr: null, min: null, max: null, mad: null, cv: null, skewness: null, kurtosis: null, outliers: [], binary };
	const s = [...xs].sort((a, b) => a - b);
	const m = mean(xs);
	const sd = n > 1 ? sampleStandardDeviation(xs) : null;
	const se = sd === null ? null : sd / Math.sqrt(n);
	const q1 = quantileSorted(s, 0.25);
	const q3 = quantileSorted(s, 0.75);
	const iqr = q3 - q1;
	const outliers: number[] = [];
	if (n >= 4 && iqr > 0) raw.forEach((x, i) => Number.isFinite(x) && (x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr) && outliers.push(i));
	return {
		n,
		mean: sig(m),
		sd: sig(sd),
		se: sig(se),
		meanCI95: se === null || se === 0 ? null : sigPair(m - t975(n - 1) * se, m + t975(n - 1) * se),
		median: sig(median(xs)),
		q1: sig(q1),
		q3: sig(q3),
		iqr: sig(iqr),
		min: s[0],
		max: s[n - 1],
		mad: sig(medianAbsoluteDeviation(xs)),
		cv: sd !== null && m !== 0 ? sig(sd / Math.abs(m)) : null,
		skewness: n >= 3 && sd ? sig(sampleSkewness(xs)) : null,
		kurtosis: n >= 4 && sd ? sig(sampleKurtosis(xs)) : null,
		outliers,
		binary
	};
}

/** Correlation of a series with itself one step later; high values make p-values too optimistic. */
export function lag1(xs: number[]): number | null {
	const n = xs.length;
	if (n < 4) return null;
	const m = mean(xs);
	let num = 0;
	let den = 0;
	for (let i = 0; i < n; i++) {
		den += (xs[i] - m) ** 2;
		if (i > 0) num += (xs[i] - m) * (xs[i - 1] - m);
	}
	return den === 0 ? null : sig(num / den);
}

// ---------- unusual values ----------

export interface Unusual {
	index: number;
	value: number;
	/** Modified z-score: how far from the median, in robust standard deviations. */
	z: number;
}

/**
 * Values with a modified z-score above 3.5 (Iglewicz and Hoaglin), which uses the median and
 * the median absolute deviation, so the outliers themselves don't hide each other. When most
 * values are equal (MAD 0), the mean absolute deviation stands in.
 */
export function unusualValues(xs: number[], threshold = 3.5): { method: string; items: Unusual[] } {
	const ok = xs.filter((x) => Number.isFinite(x));
	if (ok.length < 5) return { method: 'modified z-score (needs at least 5 values)', items: [] };
	const med = median(ok);
	const mad = medianAbsoluteDeviation(ok);
	const meanAbs = ok.reduce((a, x) => a + Math.abs(x - med), 0) / ok.length;
	const scale = mad > 0 ? mad / 0.6745 : meanAbs > 0 ? meanAbs * 1.253314 : 0;
	if (!scale) return { method: 'modified z-score (every value is the same)', items: [] };
	const items = xs
		.map((x, index) => ({ index, value: x, z: (x - med) / scale }))
		.filter((u) => Number.isFinite(u.value) && Math.abs(u.z) > threshold)
		.map((u) => ({ ...u, z: sig(u.z)! }));
	return { method: `modified z-score > ${threshold} (median ± ${mad > 0 ? 'MAD' : 'mean absolute deviation'})`, items };
}

// ---------- trend ----------

export interface Trend {
	n: number;
	/** Ordinary least squares on the step number (0, 1, 2, …). */
	ols: { slope: number | null; slopeCI95: [number, number] | null; intercept: number | null; p: number | null; r2: number | null; df: number } | null;
	/** Mann-Kendall test (no assumption about the distribution) with Sen's slope. */
	mannKendall: { tau: number | null; s: number; z: number | null; p: number | null; senSlope: number | null; size: Size | null } | null;
	/** Lag-1 autocorrelation of the residuals. */
	residualLag1: number | null;
}

export function trendTest(ys: number[]): Trend {
	const pts = ys.map((y, x) => ({ x, y })).filter((p) => Number.isFinite(p.y));
	const n = pts.length;
	if (n < 3) return { n, ols: null, mannKendall: null, residualLag1: null };
	const mx = mean(pts.map((p) => p.x));
	const my = mean(pts.map((p) => p.y));
	let sxx = 0;
	let sxy = 0;
	let syy = 0;
	for (const p of pts) {
		sxx += (p.x - mx) ** 2;
		sxy += (p.x - mx) * (p.y - my);
		syy += (p.y - my) ** 2;
	}
	const slope = sxy / sxx;
	const intercept = my - slope * mx;
	const resid = pts.map((p) => p.y - (intercept + slope * p.x));
	const sse = resid.reduce((a, r) => a + r * r, 0);
	const df = n - 2;
	const seSlope = df > 0 ? Math.sqrt(sse / df / sxx) : NaN;
	const ols = {
		slope: sig(slope),
		slopeCI95: df > 0 && seSlope > 0 ? sigPair(slope - t975(df) * seSlope, slope + t975(df) * seSlope) : null,
		intercept: sig(intercept),
		p: seSlope > 0 ? sig(tP(slope / seSlope, df)) : syy === 0 ? 1 : 0,
		r2: syy > 0 ? sig(1 - sse / syy) : null,
		df
	};

	// Mann-Kendall: S counts pairs going up minus pairs going down; ties shrink its variance.
	let s = 0;
	for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(pts[j].y - pts[i].y);
	const { ties } = rankTies(pts.map((p) => p.y));
	const varS = (n * (n - 1) * (2 * n + 5) - ties.reduce((a, t) => a + t * (t - 1) * (2 * t + 5), 0)) / 18;
	const z = varS > 0 ? (s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0) : null;
	const tau = s / ((n * (n - 1)) / 2);
	// Sen's slope: the median of every pairwise slope (capped so a long daily series stays fast).
	let senSlope: number | null = null;
	if (n <= 2000) {
		const slopes = new Float64Array((n * (n - 1)) / 2);
		let k = 0;
		for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) slopes[k++] = (pts[j].y - pts[i].y) / (pts[j].x - pts[i].x);
		slopes.sort();
		senSlope = sig(k % 2 ? slopes[(k - 1) / 2] : (slopes[k / 2 - 1] + slopes[k / 2]) / 2);
	}
	return {
		n,
		ols,
		mannKendall: { tau: sig(tau), s, z: sig(z), p: z === null ? null : sig(zP(z)), senSlope, size: sizeOfR(tau) },
		residualLag1: lag1(resid)
	};
}

// ---------- change point ----------

/** A tiny seeded random generator, so a permutation p-value is the same every time. */
function mulberry32(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The split that best separates the mean before from the mean after, by between-group sum of squares. */
function bestSplit(ys: ArrayLike<number>, minSize: number): { at: number; score: number } {
	const n = ys.length;
	let total = 0;
	for (let i = 0; i < n; i++) total += ys[i];
	let left = 0;
	let best = { at: -1, score: -1 };
	for (let k = 1; k < n; k++) {
		left += ys[k - 1];
		if (k < minSize || n - k < minSize) continue;
		const d = left / k - (total - left) / (n - k);
		const score = ((k * (n - k)) / n) * d * d;
		if (score > best.score) best = { at: k, score };
	}
	return best;
}

export interface ChangePoint {
	/** Index of the first value after the change. */
	at: number;
	before: { n: number; mean: number | null };
	after: { n: number; mean: number | null };
	shift: number | null;
	/** Share of shuffled series with a split at least this clear: the chance a shift this big shows up by luck. */
	p: number | null;
	permutations: number;
}

/**
 * The single most likely shift in the mean, with a permutation p-value: the series is
 * shuffled many times and the best split searched again each time, so the search itself is
 * accounted for (picking the best of many splits always finds something).
 */
export function changePoint(raw: number[], permutations = 999, minSize = 3): ChangePoint | null {
	const ys = raw.filter((x) => Number.isFinite(x));
	const n = ys.length;
	if (n < 2 * minSize + 2) return null;
	const found = bestSplit(ys, minSize);
	if (found.at < 0) return null;
	const before = ys.slice(0, found.at);
	const after = ys.slice(found.at);
	let p: number | null = null;
	if (found.score > 0) {
		const rand = mulberry32(n * 7919 + Math.round(found.score * 1000));
		const shuffled = Float64Array.from(ys);
		let atLeast = 0;
		for (let r = 0; r < permutations; r++) {
			for (let i = n - 1; i > 0; i--) {
				const j = Math.floor(rand() * (i + 1));
				const t = shuffled[i];
				shuffled[i] = shuffled[j];
				shuffled[j] = t;
			}
			if (bestSplit(shuffled, minSize).score >= found.score - 1e-12) atLeast++;
		}
		p = sig((atLeast + 1) / (permutations + 1));
	} else p = 1;
	const mb = mean(before);
	const ma = mean(after);
	return { at: found.at, before: { n: before.length, mean: sig(mb) }, after: { n: after.length, mean: sig(ma) }, shift: sig(ma - mb), p, permutations };
}

// ---------- two groups ----------

export interface TwoGroups {
	a: Descriptives;
	b: Descriptives;
	/** b's mean minus a's. */
	meanDifference: number | null;
	medianDifference: number | null;
	percentChange: number | null;
	welch: { t: number | null; df: number | null; p: number | null; diffCI95: [number, number] | null } | null;
	mannWhitney: { u: number; z: number | null; p: number | null; rankBiserial: number | null; size: Size | null } | null;
	/** Hedges' g: the difference in pooled standard deviations, corrected for small samples. */
	hedgesG: number | null;
	size: Size | null;
	/** For yes/no data (0 and 1 only): the two rates compared directly. */
	proportions: { a: number; b: number; difference: number; diffCI95: [number, number] | null; z: number | null; p: number | null; fisherP: number | null; cohensH: number; size: Size | null } | null;
}

/** Welch's t-test, which doesn't assume equal variances. */
export function welch(a: number[], b: number[]) {
	if (a.length < 2 || b.length < 2) return null;
	const va = sampleVariance(a) / a.length;
	const vb = sampleVariance(b) / b.length;
	const se = Math.sqrt(va + vb);
	const diff = mean(b) - mean(a);
	if (!(se > 0)) return { t: null, df: null, p: diff === 0 ? 1 : 0, diffCI95: null };
	const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
	const t = diff / se;
	return { t: sig(t), df: sig(df), p: sig(tP(t, df)), diffCI95: sigPair(diff - t975(df) * se, diff + t975(df) * se) };
}

/** Mann-Whitney U (Wilcoxon rank-sum), normal approximation with tie and continuity corrections. */
export function mannWhitney(a: number[], b: number[]) {
	const n1 = a.length;
	const n2 = b.length;
	if (!n1 || !n2) return null;
	const { ranks, ties } = rankTies([...a, ...b]);
	const r1 = ranks.slice(0, n1).reduce((x, y) => x + y, 0);
	const u1 = r1 - (n1 * (n1 + 1)) / 2;
	const u2 = n1 * n2 - u1;
	const N = n1 + n2;
	const mu = (n1 * n2) / 2;
	const sigma = Math.sqrt(((n1 * n2) / 12) * (N + 1 - ties.reduce((x, t) => x + t ** 3 - t, 0) / (N * (N - 1))));
	const z = sigma > 0 ? (u2 - mu - 0.5 * Math.sign(u2 - mu)) / sigma : null;
	// Positive when b tends to be larger: the share of pairs where b wins minus where a wins.
	const rb = (u2 - u1) / (n1 * n2);
	return { u: sig(Math.min(u1, u2))!, z: sig(z), p: z === null ? (u1 === u2 ? 1 : null) : sig(zP(z)), rankBiserial: sig(rb), size: sizeOfR(rb) };
}

const logChoose = (n: number, k: number) => jStat.gammaln(n + 1) - jStat.gammaln(k + 1) - jStat.gammaln(n - k + 1);

/** Two-sided Fisher's exact test for a 2×2 table [[a, b], [c, d]]. */
export function fisherExact(a: number, b: number, c: number, d: number): number {
	const r1 = a + b;
	const c1 = a + c;
	const n = a + b + c + d;
	const lp = (x: number) => logChoose(c1, x) + logChoose(n - c1, r1 - x) - logChoose(n, r1);
	const observed = lp(a);
	let p = 0;
	for (let x = Math.max(0, r1 + c1 - n); x <= Math.min(r1, c1); x++) {
		const l = lp(x);
		if (l <= observed + 1e-7) p += Math.exp(l);
	}
	return Math.min(1, p);
}

export function twoProportions(xa: number, na: number, xb: number, nb: number) {
	const pa = xa / na;
	const pb = xb / nb;
	const pooled = (xa + xb) / (na + nb);
	const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / na + 1 / nb));
	const se = Math.sqrt((pa * (1 - pa)) / na + (pb * (1 - pb)) / nb);
	const z = sePooled > 0 ? (pb - pa) / sePooled : null;
	const h = 2 * Math.asin(Math.sqrt(pb)) - 2 * Math.asin(Math.sqrt(pa));
	return {
		a: sig(pa)!,
		b: sig(pb)!,
		difference: sig(pb - pa)!,
		diffCI95: se > 0 ? sigPair(pb - pa - 1.959964 * se, pb - pa + 1.959964 * se) : null,
		z: sig(z),
		p: z === null ? (pa === pb ? 1 : null) : sig(zP(z)),
		fisherP: sig(fisherExact(xb, nb - xb, xa, na - xa)),
		cohensH: sig(h)!,
		size: sizeOfH(h)
	};
}

export function compareTwo(rawA: number[], rawB: number[]): TwoGroups {
	const a = rawA.filter((x) => Number.isFinite(x));
	const b = rawB.filter((x) => Number.isFinite(x));
	const da = describeSample(a);
	const db = describeSample(b);
	const ma = a.length ? mean(a) : NaN;
	const mb = b.length ? mean(b) : NaN;
	let g: number | null = null;
	if (a.length >= 2 && b.length >= 2) {
		const pooled = Math.sqrt(((a.length - 1) * sampleVariance(a) + (b.length - 1) * sampleVariance(b)) / (a.length + b.length - 2));
		if (pooled > 0) g = ((mb - ma) / pooled) * (1 - 3 / (4 * (a.length + b.length) - 9));
	}
	const binary = da.binary && db.binary;
	return {
		a: da,
		b: db,
		meanDifference: sig(mb - ma),
		medianDifference: a.length && b.length ? sig(median(b) - median(a)) : null,
		percentChange: ma ? sig(((mb - ma) / Math.abs(ma)) * 100) : null,
		welch: welch(a, b),
		mannWhitney: mannWhitney(a, b),
		hedgesG: sig(g),
		size: sizeOfD(g),
		proportions: binary && a.length && b.length ? twoProportions(a.filter((x) => x === 1).length, a.length, b.filter((x) => x === 1).length, b.length) : null
	};
}

// ---------- several groups ----------

export interface Groups {
	groups: { label: string; n: number; mean: number | null; median: number | null; sd: number | null; vsRest: { rankBiserial: number | null; p: number | null; pHolm: number | null } }[];
	kruskalWallis: { h: number | null; df: number; p: number | null; epsilon2: number | null; size: Size | null } | null;
	anova: { f: number | null; df: [number, number]; p: number | null; eta2: number | null; size: Size | null } | null;
}

/** Holm's step-down correction for several p-values at once. */
export function holm(ps: (number | null)[]): (number | null)[] {
	const idx = ps.map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p !== null).sort((x, y) => x.p - y.p);
	const out: (number | null)[] = ps.map(() => null);
	let running = 0;
	idx.forEach((x, rank) => {
		running = Math.max(running, Math.min(1, x.p * (idx.length - rank)));
		out[x.i] = sig(running);
	});
	return out;
}

export function compareGroups(input: { label: string; values: number[] }[]): Groups {
	const groups = input.map((g) => ({ label: g.label, values: g.values.filter((x) => Number.isFinite(x)) })).filter((g) => g.values.length);
	const all = groups.flatMap((g) => g.values);
	const N = all.length;
	const k = groups.length;
	let kruskalWallis: Groups['kruskalWallis'] = null;
	let anova: Groups['anova'] = null;
	if (k >= 2 && N > k) {
		const { ranks, ties } = rankTies(all);
		let offset = 0;
		let sum = 0;
		for (const g of groups) {
			const r = ranks.slice(offset, offset + g.values.length).reduce((a, b) => a + b, 0);
			sum += (r * r) / g.values.length;
			offset += g.values.length;
		}
		const correction = 1 - ties.reduce((a, t) => a + t ** 3 - t, 0) / (N ** 3 - N);
		const h = correction > 0 ? ((12 / (N * (N + 1))) * sum - 3 * (N + 1)) / correction : null;
		const e2 = h === null ? null : (h * (N + 1)) / (N * N - 1);
		kruskalWallis = { h: sig(h), df: k - 1, p: h === null ? null : sig(chiP(h, k - 1)), epsilon2: sig(e2), size: sizeOfEta(e2) };

		const grand = mean(all);
		const ssb = groups.reduce((a, g) => a + g.values.length * (mean(g.values) - grand) ** 2, 0);
		const ssw = groups.reduce((a, g) => a + g.values.reduce((x, v) => x + (v - mean(g.values)) ** 2, 0), 0);
		const f = ssw > 0 ? ssb / (k - 1) / (ssw / (N - k)) : null;
		const eta2 = ssb + ssw > 0 ? ssb / (ssb + ssw) : null;
		anova = { f: sig(f), df: [k - 1, N - k], p: f === null ? null : sig(fP(f, k - 1, N - k)), eta2: sig(eta2), size: sizeOfEta(eta2) };
	}
	// Each group against all the others, Holm-corrected so testing every group stays honest.
	const vs = groups.map((g, i) => mannWhitney(groups.flatMap((o, j) => (j === i ? [] : o.values)), g.values));
	const adjusted = holm(vs.map((v) => v?.p ?? null));
	return {
		groups: groups.map((g, i) => ({
			label: g.label,
			n: g.values.length,
			mean: sig(mean(g.values)),
			median: sig(median(g.values)),
			sd: g.values.length > 1 ? sig(sampleStandardDeviation(g.values)) : null,
			vsRest: { rankBiserial: vs[i]?.rankBiserial ?? null, p: vs[i]?.p ?? null, pHolm: adjusted[i] }
		})),
		kruskalWallis,
		anova
	};
}

// ---------- correlation ----------

/** 95% confidence interval of a correlation coefficient (Fisher's z). */
export function correlationCI(r: number, n: number): [number, number] | null {
	if (n < 4 || Math.abs(r) >= 1) return null;
	const z = Math.atanh(r);
	const se = 1 / Math.sqrt(n - 3);
	return sigPair(Math.tanh(z - 1.959964 * se), Math.tanh(z + 1.959964 * se));
}
