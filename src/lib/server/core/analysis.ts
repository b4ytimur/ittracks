// Numbers for AI assistants and scripts, worked out on the server with the same engine as the
// Stats page: a time series of any measure (per day, week, month…, split by habit, Task,
// muscle group, weekday…), and the correlation between two of them. The assistant asks for
// the math instead of pulling every row and adding them up itself, and every number can be
// traced back to the logs behind it with `drill`.
import { pointsFor, autoBucket, bucketList, combine, resolveRange, unitOf, type BucketInfo, type Point, type Prepared } from '$lib/stats/engine';
import {
	ADDS_UP,
	BUCKETS,
	OVER_TIME,
	PER_LOG,
	PER_LOG_FOR,
	SHARE_MEASURES,
	SOURCES,
	SPLITS,
	RANGES,
	makeCard,
	perLogLabel,
	type Bucket,
	type OverTime,
	type Source,
	type Split,
	type StatCard
} from '$lib/stats/model';
import { autoTitle } from '$lib/stats/catalog';
import { catalogFor, ctxFor, getStats } from '../stats';
import { correlate, fitLine, summarize } from '$lib/engine/correlate';
import { ActionError, requireScope, type Actor } from './actor';
import { findHabit } from './day';
import { preparedFor, rangeOf } from './read';

export interface SeriesSpec {
	source?: Source;
	habits?: string[];
	fields?: string[];
	task?: string | null;
	tags?: string[];
	measure?: string | null;
	combine?: OverTime;
	bucket?: Bucket;
	split?: Split;
	from?: string | null;
	to?: string | null;
	days?: number | null;
	range?: string | null;
}

/** The per-log measure a source starts with. */
const DEFAULT_MEASURE: Record<Source, string> = { outcomes: 'done', field: 'value', task: 'volume', slips: 'count', cravings: 'count', money: 'saved' };

/** Every option, with what it means: shown by describe_analysis so an assistant can build a request. */
export function analysisOptions() {
	return {
		sources: SOURCES,
		measures: Object.fromEntries(Object.entries(PER_LOG_FOR).map(([src, keys]) => [src, Object.fromEntries(keys.map((k) => [k, PER_LOG[k]]))])),
		customMeasures: 'Also "custom:<id>" for the custom measures describe lists (source task).',
		combine: OVER_TIME,
		buckets: BUCKETS,
		splits: SPLITS,
		ranges: { ...RANGES, 'since:YYYY-MM-DD': 'From a date to today', 'from/to': 'Or send from and to (YYYY-MM-DD), or days' },
		notes: [
			'outcomes/rate is 1 for done and 0 for missed per scheduled day; average it for consistency.',
			'field/value reads once-per-log fields; for per-set fields use sum, best, avg or sets.',
			'Fields named by name roll up every field with that name; use ids from describe to be exact.',
			'Sums and counts of an empty bucket are 0; averages and bests of an empty bucket are null.',
			'Times are added up in minutes; weights convert between kg and lb.'
		]
	};
}

/** Turn a request into a Stats card, resolving names to ids. */
function cardOf(actor: Actor, P: Prepared, spec: SeriesSpec): StatCard {
	const source = spec.source ?? 'outcomes';
	const measure = spec.measure ?? DEFAULT_MEASURE[source];
	const allowed = PER_LOG_FOR[source] as string[];
	if (!allowed.includes(measure) && !(source === 'task' && measure.startsWith('custom:')))
		throw new ActionError('invalid', `“${measure}” isn't a measure of ${source}. Use one of: ${allowed.join(', ')}.`);
	const habits = (spec.habits ?? []).map((r) => findHabit(actor, r).id);
	// A key limited to some habits only ever reads those.
	const scopeHabits = habits.length ? habits : actor.habitIds ? [...actor.habitIds] : [];
	let metrics: string[] = [];
	let name: string | null = null;
	if (source === 'field') {
		const fields = spec.fields ?? [];
		if (!fields.length) throw new ActionError('invalid', 'Name the field(s) to read, by id or name (see describe).');
		for (const f of fields) {
			const byId = P.metrics.get(f);
			if (byId) {
				metrics.push(byId.id);
				continue;
			}
			const key = f.trim().toLowerCase();
			let named = P.ds.metrics.filter((m) => m.name.trim().toLowerCase() === key);
			// A Task's name stands for its one number: "Water" for the Glasses field of Task Water.
			if (!named.length) {
				const tasks = P.ds.tasks.filter((t) => t.name.trim().toLowerCase() === key);
				const nums = tasks.flatMap((t) => (P.metricsByTask.get(t.id) ?? []).filter((m) => ['number', 'count', 'duration'].includes(m.type)));
				if (nums.length === 1) {
					metrics.push(nums[0].id);
					continue;
				}
			}
			if (!named.length) throw new ActionError('not_found', `No field called “${f}”. See describe for field names and ids.`);
			if (fields.length === 1) name = named[0].name;
			else metrics.push(...named.map((m) => m.id));
		}
		metrics = [...new Set(metrics)].slice(0, 10);
	}
	let taskId: string | null = null;
	if (spec.task) {
		const t = P.tasks.get(spec.task) ?? P.ds.tasks.find((x) => x.name.trim().toLowerCase() === spec.task!.trim().toLowerCase());
		if (!t) throw new ActionError('not_found', `No Task called “${spec.task}”.`);
		taskId = t.id;
	}
	return makeCard({
		what: { source, metrics, name, taskId },
		perLog: measure,
		overTime: spec.combine ?? (source === 'outcomes' && measure !== 'done' ? 'avg' : 'sum'),
		bucket: spec.bucket ?? 'auto',
		split: spec.split ?? 'none',
		filter: { habits: scopeHabits, tags: spec.tags ?? [], areas: [] },
		look: { chart: 'line', top: 20 }
	});
}

function rangeFor(actor: Actor, P: Prepared, spec: SeriesSpec) {
	if (spec.range && !spec.from && !spec.to) {
		const today = rangeOf(actor, {}).today;
		if (!/^(week|7d|month|30d|90d|year|12m|all|since:\d{4}-\d{2}-\d{2})$/.test(spec.range))
			throw new ActionError('invalid', `Unknown range “${spec.range}”. Use ${Object.keys(RANGES).join(', ')}, since:YYYY-MM-DD, or from/to.`);
		return { ...resolveRange(spec.range, today, P.earliest), today };
	}
	return rangeOf(actor, spec, 30);
}

function bucketed(points: Point[], buckets: BucketInfo[]): Point[][] {
	const out: Point[][] = buckets.map(() => []);
	let i = 0;
	for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
		while (i < buckets.length && p.date > buckets[i].to) i++;
		if (i >= buckets.length) break;
		if (p.date >= buckets[i].from) out[i].push(p);
	}
	return out;
}

const round = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);

/** Work out one request: its buckets, its series and the points behind them. */
export function compute(actor: Actor, P: Prepared, spec: SeriesSpec) {
	const card = cardOf(actor, P, spec);
	const range = rangeFor(actor, P, spec);
	const stats = getStats(actor.accountId);
	const ctx = ctxFor(range.today, stats);
	const points = pointsFor(card, P, ctx, { from: range.from, to: range.to });
	const { unit, kind, share } = unitOf(card, P, ctx);
	const scale = (v: number | null) => (v === null ? null : share ? v * 100 : v);
	const how = card.overTime;
	let buckets: BucketInfo[];
	let groups: Point[][];
	const kindOf = card.bucket === 'auto' ? autoBucket(range) : card.bucket;
	if (kindOf === 'session') {
		const g = new Map<string, Point[]>();
		for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
			const k = p.occId ?? p.date;
			g.set(k, [...(g.get(k) ?? []), p]);
		}
		buckets = [...g.entries()].map(([k, ps]) => ({ key: k, label: ps[0].date, from: ps[0].date, to: ps[0].date }));
		groups = [...g.values()];
	} else {
		buckets = bucketList(range, kindOf);
		groups = bucketed(points, buckets);
	}
	const keys = new Map<string, { label: string; order: number }>();
	for (const p of points) for (const s of p.series) if (!keys.has(s.key)) keys.set(s.key, { label: s.label, order: s.order });
	const wv = (p: Point, key: string) => {
		const s = p.series.find((x) => x.key === key);
		return s ? { v: p.value, w: s.w, date: p.date } : null;
	};
	const label = autoTitle(card, catalogFor(actor.accountId, P), stats.measures);
	const series = [...keys.entries()]
		.sort((a, b) => a[1].order - b[1].order || a[1].label.localeCompare(b[1].label))
		.map(([key, k]) => {
			const values = groups.map((g) => round(scale(combine(g.map((p) => wv(p, key)).filter((x): x is NonNullable<typeof x> => !!x), how))));
			const nums = values.filter((v): v is number => v !== null);
			const idx = values.map((v, i) => (v === null ? null : i)).filter((i): i is number => i !== null);
			const fit = fitLine(idx, nums);
			return {
				key,
				label: k.label || label,
				total: round(scale(combine(points.map((p) => wv(p, key)).filter((x): x is NonNullable<typeof x> => !!x), how))),
				values,
				summary: summarize(nums),
				trendPerBucket: fit ? round(fit.slope) : null
			};
		});
	return {
		card,
		range,
		points,
		buckets,
		series,
		label,
		unit,
		kind,
		share,
		total: round(scale(combine(points.map((p) => ({ v: p.value, w: 1, date: p.date })), how))),
		bucket: kindOf
	};
}

export type Computed = ReturnType<typeof compute>;

/**
 * A request's first series, one value per bucket, null outside the tracked span. Sums of an
 * empty bucket are 0, but only between a series' first and last log: before someone started
 * tracking, a 0 would be made up.
 */
export function observed(r: Computed): (number | null)[] {
	const vals = r.series[0]?.values ?? r.buckets.map(() => null);
	const has = r.buckets.map((b) => r.points.some((p) => p.date >= b.from && p.date <= b.to));
	const first = has.indexOf(true);
	const last = has.lastIndexOf(true);
	return vals.map((v, i) => (first < 0 || i < first || i > last ? null : v));
}

/** A time series of any measure: the Stats page's numbers, as data. */
export function series(actor: Actor, input: SeriesSpec & { drill?: boolean; format?: 'json' | 'csv' }) {
	requireScope(actor, 'read');
	const P = preparedFor(actor);
	const r = compute(actor, P, input);
	const measures = getStats(actor.accountId).measures;
	const out = {
		title: r.label,
		from: r.range.from,
		to: r.range.to,
		measure: `${perLogLabel(r.card.perLog, measures)} (${r.card.perLog})`,
		combine: `${OVER_TIME[r.card.overTime]} (${r.card.overTime})`,
		bucket: r.bucket,
		unit: r.share ? '%' : r.unit,
		total: r.total,
		buckets: r.buckets.map((b) => ({ from: b.from, to: b.to })),
		series: r.series,
		emptyBucketsAre: ADDS_UP.includes(r.card.overTime) ? 0 : null,
		logsBehind: r.points.length
	};
	const drill = input.drill
		? r.points
				.sort((a, b) => b.date.localeCompare(a.date))
				.slice(0, 300)
				.map((p) => ({
					ref: p.occId ? `log:${p.occId}` : null,
					date: p.date,
					value: round(r.share ? p.value * 100 : p.value),
					habit: P.habits.get(p.habitId)?.name ?? null,
					task: p.taskId ? (P.tasks.get(p.taskId)?.name ?? null) : null,
					series: p.series.map((s) => s.label).filter(Boolean).join(', ') || undefined
				}))
		: undefined;
	if (input.format === 'csv') {
		const head = ['from', 'to', ...r.series.map((s) => s.label.replace(/[",\n]/g, ' '))];
		const rows = r.buckets.map((b, i) => [b.from, b.to, ...r.series.map((s) => (s.values[i] === null ? '' : String(s.values[i])))]);
		const { series: _s, buckets: _b, ...rest } = out;
		void _s;
		void _b;
		return { ...rest, csv: [head.join(','), ...rows.map((x) => x.join(','))].join('\n'), drill };
	}
	return { ...out, drill };
}

/**
 * How two measures move together, per day (or week, month): Pearson and Spearman, a p-value,
 * and the straight-line fit. `lag` pairs A with B that many buckets later (sleep tonight vs
 * training tomorrow). Buckets where either side has no data are left out.
 */
export function correlation(
	actor: Actor,
	input: {
		a: SeriesSpec;
		b: SeriesSpec;
		bucket?: 'day' | 'week' | 'month';
		from?: string | null;
		to?: string | null;
		days?: number | null;
		lag?: number;
		includePairs?: boolean;
	}
) {
	requireScope(actor, 'read');
	const P = preparedFor(actor);
	const shared = { from: input.from, to: input.to, days: input.days ?? 90, bucket: input.bucket ?? 'day', split: 'none' as const };
	const A = compute(actor, P, { ...input.a, ...shared });
	const B = compute(actor, P, { ...input.b, ...shared });
	const av = observed(A);
	const bv = observed(B);
	const lag = Math.max(-60, Math.min(60, Math.round(input.lag ?? 0)));
	const pairs: { from: string; a: number; b: number; bFrom: string }[] = [];
	for (let i = 0; i < av.length; i++) {
		const j = i + lag;
		if (j < 0 || j >= bv.length) continue;
		const x = av[i];
		const y = bv[j];
		if (x === null || y === null) continue;
		pairs.push({ from: A.buckets[i].from, a: x, b: y, bFrom: B.buckets[j].from });
	}
	const c = correlate(pairs.map((p) => p.a), pairs.map((p) => p.b));
	const what = (r: Computed) => `${r.label}${r.unit ? ` (${r.share ? '%' : r.unit})` : ''}`;
	const by = shared.bucket;
	let reading: string;
	if (c.pearson === null) reading = `Not enough paired ${by}s to compare (${c.n}). Widen the range or use a larger bucket.`;
	else
		reading =
			`${c.strength === 'none' ? 'No clear link' : `A ${c.strength} ${c.direction === 'up' ? 'positive' : 'negative'} link`} between ${what(A)} and ${what(B)}` +
			`${lag ? ` ${Math.abs(lag)} ${by}${Math.abs(lag) === 1 ? '' : 's'} ${lag > 0 ? 'later' : 'earlier'}` : ''}: r = ${c.pearson}${c.ci95 ? ` (95% CI ${c.ci95[0]} to ${c.ci95[1]})` : ''}, ρ = ${c.spearman}, ` +
			`p ${c.p === null ? 'n/a' : c.p < 0.001 ? '< 0.001' : `= ${c.p}`}, n = ${c.n} ${by}s.` +
			(c.p !== null && c.p >= 0.05 ? ' This could easily be chance.' : '') +
			' A correlation alone does not show that one causes the other.';
	return {
		from: A.range.from,
		to: A.range.to,
		bucket: by,
		lag,
		a: { label: what(A), measure: A.card.perLog, combine: A.card.overTime, buckets: av.filter((v) => v !== null).length },
		b: { label: what(B), measure: B.card.perLog, combine: B.card.overTime, buckets: bv.filter((v) => v !== null).length },
		result: c,
		fitMeans: c.fit ? `B ≈ ${c.fit.intercept} + ${c.fit.slope} × A` : null,
		reading,
		pairs: input.includePairs ? pairs.slice(0, 400) : undefined
	};
}
