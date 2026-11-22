// Statistics on any measure, for AI assistants: describe a measure, test for a trend and a
// shift, compare before and after a date, and compare weekdays or months. The numbers come
// from the same engine as series and correlate; the tests are in $lib/engine/statistics.
//
// Every answer names its methods, gives n, an effect size with words for its size, p-values
// and confidence intervals, a plain reading, and caveats (small samples, skew, days that
// follow each other, before/after is not an experiment), so an assistant has what it needs
// not to overclaim.
import { addDays, daysBetween, weekday } from '$lib/engine/dates';
import { changePoint, compareGroups, compareTwo, describeSample, lag1, sig, trendTest, unusualValues } from '$lib/engine/statistics';
import { ActionError, requireScope, type Actor } from './actor';
import { compute, observed, type Computed, type SeriesSpec } from './analysis';
import { preparedFor, rangeOf } from './read';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
type Measure = Omit<SeriesSpec, 'split' | 'bucket' | 'from' | 'to' | 'days' | 'range'>;
type Bucket = 'day' | 'week' | 'month';

interface Input {
	measure: Measure;
	bucket?: Bucket;
	from?: string | null;
	to?: string | null;
	days?: number | null;
}

/** "1 day", "3 days". */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** "p < 0.001" or "p = 0.03". */
const pText = (p: number | null | undefined) => (p === null || p === undefined ? 'p n/a' : p < 0.001 ? 'p < 0.001' : `p = ${sig(p)}`);
const num = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : String(sig(v)));
const signed = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : `${v > 0 ? '+' : ''}${sig(v)}`);
const ci = (c: [number, number] | null | undefined) => (c ? `95% CI ${c[0]} to ${c[1]}` : 'no CI');

function labelOf(r: Computed) {
	return `${r.label}${r.unit ? ` (${r.share ? '%' : r.unit})` : ''}`;
}

/** One value per bucket that has data, with its dates and the logs behind it. */
function valuesOf(r: Computed) {
	const vals = observed(r);
	return r.buckets
		.map((b, i) => ({ from: b.from, to: b.to, value: vals[i] }))
		.filter((x): x is { from: string; to: string; value: number } => x.value !== null);
}

function refsFor(r: Computed, from: string, to: string) {
	return [...new Set(r.points.filter((p) => p.date >= from && p.date <= to && p.occId).map((p) => `log:${p.occId}`))].slice(0, 5);
}

/** The caveats that apply, in plain words. */
function caveats(o: { n: number; bucket: Bucket; lag?: number | null; skew?: number | null; binary?: boolean; coverage?: { have: number; of: number }; smallGroup?: number }) {
	const out: string[] = [];
	if (o.n < 10) out.push(`Only ${plural(o.n, 'value')}: too few to conclude much. Treat any p-value as a rough hint.`);
	else if (o.n < 30) out.push(`${o.n} values is a small sample: confidence intervals are wide and p-values move a lot with a few more ${o.bucket}s.`);
	if (o.smallGroup !== undefined && o.smallGroup < 5) out.push(`A group has only ${plural(o.smallGroup, 'value')}, so its comparison is unreliable.`);
	if (o.skew !== null && o.skew !== undefined && Math.abs(o.skew) > 1)
		out.push('The values are skewed, so prefer the rank-based results (Mann-Whitney, Kruskal-Wallis, Mann-Kendall) over the t-test, ANOVA and least squares.');
	if (o.lag !== null && o.lag !== undefined && o.lag > 0.3)
		out.push(`Consecutive ${o.bucket}s are correlated (lag-1 r = ${o.lag}), so the p-values are too optimistic.${o.bucket === 'day' ? ' Weekly buckets reduce this.' : ''}`);
	if (o.binary) out.push('The values are yes/no (1 or 0), so averages are rates.');
	if (o.coverage && o.coverage.of > 0 && o.coverage.have / o.coverage.of < 0.6)
		out.push(`Only ${o.coverage.have} of ${plural(o.coverage.of, o.bucket)} in the range ${o.coverage.have === 1 ? 'has' : 'have'} data; gaps can hide what happened in between.`);
	return out;
}

function prepare(actor: Actor, input: Input, defaults: { days: number; bucket: Bucket }) {
	requireScope(actor, 'read');
	const P = preparedFor(actor);
	const bucket = input.bucket ?? defaults.bucket;
	const r = compute(actor, P, { ...input.measure, from: input.from, to: input.to, days: input.days ?? defaults.days, bucket, split: 'none' });
	return { P, r, bucket, values: valuesOf(r) };
}

// ---------- describe ----------

export function statsDescribe(actor: Actor, input: Input) {
	const { r, bucket, values } = prepare(actor, input, { days: 90, bucket: 'day' });
	const xs = values.map((v) => v.value);
	const d = describeSample(xs);
	const odd = unusualValues(xs);
	const lag = lag1(xs);
	const unusual = odd.items.map((u) => ({
		from: values[u.index].from,
		to: values[u.index].to,
		value: u.value,
		z: u.z,
		ref: bucket === 'day' ? `day:${values[u.index].from}` : null,
		logs: refsFor(r, values[u.index].from, values[u.index].to)
	}));
	const what = labelOf(r);
	const reading = !d.n
		? `No ${what} data from ${r.range.from} to ${r.range.to}.`
		: `${what}, ${r.range.from} to ${r.range.to} (n = ${plural(d.n, bucket)}): ` +
			(d.binary ? `yes on ${num((d.mean ?? 0) * 100)}% of ${bucket}s` : `mean ${num(d.mean)} (${ci(d.meanCI95)}), median ${num(d.median)}, sd ${num(d.sd)}, range ${d.min} to ${d.max}`) +
			`. ${unusual.length ? `${unusual.length} unusual ${bucket}${unusual.length === 1 ? '' : 's'}: ${unusual.slice(0, 5).map((u) => `${u.from} (${u.value})`).join(', ')}.` : `No unusual ${bucket}s.`}`;
	return {
		measure: what,
		from: r.range.from,
		to: r.range.to,
		bucket,
		n: d.n,
		methods: ['descriptive statistics (sample sd; mean CI from the t distribution)', "Tukey's fences for outliers (1.5 × IQR)", odd.method],
		descriptives: { ...d, outliers: d.outliers.map((i) => values[i].from) },
		lag1: lag,
		unusual,
		reading,
		caveats: caveats({ n: d.n, bucket, lag, skew: d.skewness, binary: d.binary, coverage: { have: values.length, of: r.buckets.length } })
	};
}

// ---------- trend ----------

export function statsTrend(actor: Actor, input: Input & { changePoint?: boolean }) {
	const { r, bucket, values } = prepare(actor, input, { days: 90, bucket: 'day' });
	const xs = values.map((v) => v.value);
	// Gaps matter for a trend: use each bucket's position in the range, not its position in the list.
	const pos = new Map(r.buckets.map((b, i) => [b.from, i]));
	const dense: number[] = new Array(r.buckets.length).fill(NaN);
	for (const v of values) dense[pos.get(v.from)!] = v.value;
	const t = trendTest(dense);
	const cp = input.changePoint === false ? null : changePoint(xs);
	const d = describeSample(xs);
	const what = labelOf(r);
	let reading: string;
	if (!t.ols || !t.mannKendall) reading = `Not enough ${bucket}s with data for a trend (n = ${t.n}).`;
	else {
		const dir = (t.ols.slope ?? 0) > 0 ? 'rising' : (t.ols.slope ?? 0) < 0 ? 'falling' : 'flat';
		const clear = (t.ols.p ?? 1) < 0.05 && (t.mannKendall.p ?? 1) < 0.05;
		reading =
			`${what}, ${r.range.from} to ${r.range.to} (n = ${plural(t.n, bucket)}): ${clear ? '' : 'no clear trend; '}${dir} by ${signed(t.ols.slope)} per ${bucket} ` +
			`(${ci(t.ols.slopeCI95)}, ${pText(t.ols.p)}, R² = ${num(t.ols.r2)}). Mann-Kendall τ = ${num(t.mannKendall.tau)}, ${pText(t.mannKendall.p)}; Sen's slope ${signed(t.mannKendall.senSlope)} per ${bucket}.`;
		if (cp)
			reading += ` Most likely shift: from ${values[cp.at].from}, mean ${num(cp.before.mean)} before and ${num(cp.after.mean)} after (permutation ${pText(cp.p)}${(cp.p ?? 1) >= 0.05 ? ', could easily be chance' : ''}).`;
	}
	return {
		measure: what,
		from: r.range.from,
		to: r.range.to,
		bucket,
		n: t.n,
		methods: [
			`ordinary least squares on the ${bucket} number, slope CI from the t distribution`,
			"Mann-Kendall trend test (tie-corrected, normal approximation) with Sen's slope",
			...(cp ? [`single change point in the mean (best split by between-group sum of squares), p from ${cp.permutations} seeded permutations`] : [])
		],
		leastSquares: t.ols,
		mannKendall: t.mannKendall,
		changePoint: cp
			? { from: values[cp.at].from, before: cp.before, after: cp.after, shift: cp.shift, p: cp.p, ref: bucket === 'day' ? `day:${values[cp.at].from}` : null }
			: null,
		residualLag1: t.residualLag1,
		reading,
		caveats: [
			...caveats({ n: t.n, bucket, lag: t.residualLag1, skew: d.skewness, binary: d.binary, coverage: { have: values.length, of: r.buckets.length } }),
			'A trend describes the past; it does not say the line will continue.'
		]
	};
}

// ---------- before and after ----------

interface CompareInput extends Omit<Input, 'from' | 'to' | 'days'> {
	at?: string | null;
	days?: number | null;
	before?: { from: string; to: string } | null;
	after?: { from: string; to: string } | null;
}

export function statsCompare(actor: Actor, input: CompareInput) {
	requireScope(actor, 'read');
	const today = rangeOf(actor, {}).today;
	let before: { from: string; to: string };
	let after: { from: string; to: string };
	if (input.before && input.after) {
		before = { from: rangeOf(actor, input.before).from, to: rangeOf(actor, input.before).to };
		after = { from: rangeOf(actor, input.after).from, to: rangeOf(actor, input.after).to };
		if (before.to >= after.from && after.to >= before.from) throw new ActionError('invalid', 'before and after overlap. Give two separate periods.');
	} else if (input.at) {
		const at = rangeOf(actor, { from: input.at, to: input.at }).from;
		if (at > today) throw new ActionError('invalid', 'at is in the future.');
		const wanted = input.days ?? Math.min(90, daysBetween(at, today) + 1);
		const span = Math.max(1, Math.min(wanted, daysBetween(at, today) + 1));
		after = { from: at, to: addDays(at, span - 1) };
		before = { from: addDays(at, -span), to: addDays(at, -1) };
	} else throw new ActionError('invalid', 'Send at (the first day after the change), or before and after periods ({from, to} each).');
	const first = before.from < after.from ? before : after;
	const second = first === before ? after : before;
	const bucket = input.bucket ?? 'day';
	const { r, values } = prepare(actor, { measure: input.measure, bucket, from: first.from, to: second.to }, { days: 90, bucket: 'day' });
	// A week or month that crosses the boundary belongs to neither side.
	const inside = (v: { from: string; to: string }, p: { from: string; to: string }) => v.from >= p.from && v.to <= p.to;
	const bv = values.filter((v) => inside(v, before)).map((v) => v.value);
	const av = values.filter((v) => inside(v, after)).map((v) => v.value);
	// Done/missed per day comes as 0 or 100 (%): compare it as two rates.
	const asRate = r.share && [...bv, ...av].every((v) => v === 0 || v === 100);
	const c = asRate ? compareTwo(bv.map((v) => v / 100), av.map((v) => v / 100)) : compareTwo(bv, av);
	const what = labelOf(r);
	const binary = !!c.proportions;
	let reading: string;
	if (!bv.length || !av.length) reading = `No ${what} data ${!bv.length ? 'before' : 'after'} the change, so there is nothing to compare.`;
	else if (binary && c.proportions)
		reading =
			`${what}: yes on ${num(c.proportions.b * 100)}% of ${bucket}s after (${after.from} to ${after.to}, n = ${av.length}) vs ${num(c.proportions.a * 100)}% before (${before.from} to ${before.to}, n = ${bv.length}); ` +
			`difference ${signed(c.proportions.difference * 100)} points (${c.proportions.diffCI95 ? `95% CI ${sig(c.proportions.diffCI95[0] * 100)} to ${sig(c.proportions.diffCI95[1] * 100)}` : 'no CI'}), ` +
			`Fisher's exact ${pText(c.proportions.fisherP)}, Cohen's h = ${c.proportions.cohensH} (${c.proportions.size}).`;
	else
		reading =
			`${what}: mean ${num(c.b.mean)} after (${after.from} to ${after.to}, n = ${av.length}) vs ${num(c.a.mean)} before (${before.from} to ${before.to}, n = ${bv.length}); ` +
			`difference ${signed(c.meanDifference)} (${ci(c.welch?.diffCI95)}), Welch ${pText(c.welch?.p)}, Mann-Whitney ${pText(c.mannWhitney?.p)}. ` +
			`Effect: ${c.size ?? 'n/a'} (Hedges' g = ${num(c.hedgesG)}; rank-biserial r = ${num(c.mannWhitney?.rankBiserial)}).`;
	const n = bv.length + av.length;
	return {
		measure: what,
		bucket,
		before: { ...before, n: bv.length },
		after: { ...after, n: av.length },
		methods: binary
			? ['two proportions: z-test (pooled) with a Wald CI for the difference', "Fisher's exact test", "Cohen's h"]
			: ["Welch's t-test (unequal variances) with a CI for the difference", 'Mann-Whitney U (tie-corrected normal approximation)', "Hedges' g", 'rank-biserial correlation'],
		result: c,
		reading,
		caveats: [
			...caveats({
				n,
				bucket,
				// Within each side: the change itself would otherwise look like days following each other.
				lag: Math.max(lag1(bv) ?? 0, lag1(av) ?? 0),
				skew: Math.max(Math.abs(c.a.skewness ?? 0), Math.abs(c.b.skewness ?? 0)),
				smallGroup: Math.min(bv.length, av.length)
			}),
			'Before/after is not an experiment: anything else that changed around the same time (season, schedule, illness, what got logged) could explain a difference.'
		]
	};
}

// ---------- groups ----------

export function statsGroups(actor: Actor, input: Omit<Input, 'bucket'> & { by: 'weekday' | 'weekend' | 'month' }) {
	const { r, values } = prepare(actor, { ...input, bucket: 'day' }, { days: input.by === 'month' ? 365 : 90, bucket: 'day' });
	const keyOf = (date: string) =>
		input.by === 'weekday' ? WEEKDAYS[weekday(date)] : input.by === 'weekend' ? (weekday(date) >= 5 ? 'Weekend' : 'Weekday') : date.slice(0, 7);
	const order = input.by === 'weekday' ? WEEKDAYS : input.by === 'weekend' ? ['Weekday', 'Weekend'] : [...new Set(values.map((v) => v.from.slice(0, 7)))].sort();
	const groups = order.map((label) => ({ label, values: values.filter((v) => keyOf(v.from) === label).map((v) => v.value) }));
	const g = compareGroups(groups);
	const d = describeSample(values.map((v) => v.value));
	const what = labelOf(r);
	const ranked = [...g.groups].filter((x) => x.mean !== null).sort((x, y) => (y.mean ?? 0) - (x.mean ?? 0));
	const standOut = g.groups.filter((x) => (x.vsRest.pHolm ?? 1) < 0.05);
	const kw = g.kruskalWallis;
	const reading =
		ranked.length < 2
			? `Not enough data to compare ${input.by === 'month' ? 'months' : 'days of the week'} (n = ${d.n}).`
			: `${what} by ${input.by === 'weekend' ? 'weekday vs weekend' : input.by}, ${r.range.from} to ${r.range.to} (n = ${plural(d.n, 'day')}): highest ${ranked[0].label} (${d.binary ? `${num((ranked[0].mean ?? 0) * 100)}%` : `mean ${num(ranked[0].mean)}`}), ` +
				`lowest ${ranked.at(-1)!.label} (${d.binary ? `${num((ranked.at(-1)!.mean ?? 0) * 100)}%` : `mean ${num(ranked.at(-1)!.mean)}`}). ` +
				`Kruskal-Wallis ${pText(kw?.p)}, ε² = ${num(kw?.epsilon2)} (${kw?.size ?? 'n/a'}): ${(kw?.p ?? 1) < 0.05 ? 'the groups differ' : 'no clear difference between groups'}.` +
				(standOut.length ? ` Stand out against the rest (Holm-corrected): ${standOut.map((x) => x.label).join(', ')}.` : '');
	return {
		measure: what,
		from: r.range.from,
		to: r.range.to,
		by: input.by,
		n: d.n,
		methods: ['Kruskal-Wallis H (tie-corrected) with ε²', 'one-way ANOVA with η²', 'each group vs the rest: Mann-Whitney U, Holm-corrected'],
		groups: g.groups,
		kruskalWallis: g.kruskalWallis,
		anova: g.anova,
		reading,
		caveats: caveats({
			n: d.n,
			bucket: 'day',
			skew: d.skewness,
			binary: d.binary,
			smallGroup: g.groups.length ? Math.min(...g.groups.map((x) => x.n)) : 0,
			coverage: { have: values.length, of: r.buckets.length }
		})
	};
}
