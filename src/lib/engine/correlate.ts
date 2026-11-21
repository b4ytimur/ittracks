// Plain statistics for the analysis tools: a summary of numbers, Pearson and Spearman
// correlation with a p-value, and a straight-line fit. Small and dependency-free, so an AI
// assistant (or a script) gets the math done on the server instead of in its head.

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

// Regularized incomplete beta function, for the t-distribution (Numerical Recipes, betacf).
function logGamma(x: number): number {
	const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
	let y = x;
	const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
	let ser = 1.000000000190015;
	for (const k of c) ser += k / ++y;
	return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
	const MAXIT = 200;
	const EPS = 3e-14;
	const FPMIN = 1e-300;
	const qab = a + b;
	const qap = a + 1;
	const qam = a - 1;
	let c = 1;
	let d = 1 - (qab * x) / qap;
	if (Math.abs(d) < FPMIN) d = FPMIN;
	d = 1 / d;
	let h = d;
	for (let m = 1; m <= MAXIT; m++) {
		const m2 = 2 * m;
		let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < FPMIN) d = FPMIN;
		c = 1 + aa / c;
		if (Math.abs(c) < FPMIN) c = FPMIN;
		d = 1 / d;
		h *= d * c;
		aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < FPMIN) d = FPMIN;
		c = 1 + aa / c;
		if (Math.abs(c) < FPMIN) c = FPMIN;
		d = 1 / d;
		const del = d * c;
		h *= del;
		if (Math.abs(del - 1) < EPS) break;
	}
	return h;
}

export function incompleteBeta(x: number, a: number, b: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
	return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value that a correlation r over n pairs is really zero (t-test, n − 2 degrees of freedom). */
export function correlationP(r: number, n: number): number | null {
	if (n < 4) return null;
	if (Math.abs(r) >= 1) return 0;
	const df = n - 2;
	const t = (r * Math.sqrt(df)) / Math.sqrt(1 - r * r);
	return r6(incompleteBeta(df / (df + t * t), df / 2, 0.5));
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
	p: number | null;
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
		strength: strength(r),
		direction: r === null || Math.abs(r) < 0.1 ? 'none' : r > 0 ? 'up' : 'down',
		fit: fitLine(a, b)
	};
}
