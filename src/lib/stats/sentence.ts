// A card as a sentence: what each of its words offers, and what moves when a word doesn't go with
// another. The stored card gains nothing; a card this returns is always one the engine takes.
import { checkCard } from '$lib/rules/stats';
import { cardFields, perLogChoices, statCtx, type Catalog } from './catalog';
import { BUCKETS, CHARTS, PER_LOG, RANGES, SHARE_MEASURES, isCustom, measureOf, rangeLabel, type Chart, type CustomMeasure, type StatCard } from './model';
import type { CardResult } from './engine';
import { value } from './format';

export interface Offer {
	catalog: Catalog;
	measures: CustomMeasure[];
	hidden: string[];
}
export interface Choice {
	value: string;
	label: string;
}
export type SlotKey = 'subject' | 'measure' | 'bucket' | 'range';

const short = (s: string) => s.replace(/ \(.*\)$/, '');
export const measureLabel = (perLog: string, measures: CustomMeasure[]) =>
	isCustom(perLog) ? (measureOf(perLog, measures)?.name ?? 'A measure') : short(PER_LOG[perLog as keyof typeof PER_LOG] ?? perLog);

const issues = (c: StatCard, o: Offer) => checkCard(c, statCtx(c, o.catalog, { hidden: o.hidden, measures: o.measures })).filter((i) => i.severity === 'block');
export const works = (c: StatCard, o: Offer) => issues(c, o).length === 0;

const defaultOver = (perLog: string, c: StatCard, o: Offer): StatCard['overTime'] =>
	measureOf(perLog, o.measures)?.over ?? (SHARE_MEASURES.includes(perLog) || perLog === 'pctTarget'
		? 'avg'
		: perLog === 'best'
			? 'max'
			: perLog === 'option' || perLog === 'present'
				? 'count'
				: perLog === 'value' && cardFields(c, o.catalog)[0]?.type === 'number'
					? 'avg'
					: 'sum');

// ---------- what a word offers ----------

export function subjectOf(c: StatCard): string {
	if (c.what.source === 'task') return c.what.taskId ? `task:${c.what.taskId}` : 'tasks';
	if (c.what.source === 'field') return c.what.name ? `name:${c.what.name}` : c.what.metrics.length === 1 ? `field:${c.what.metrics[0]}` : 'fields';
	return c.filter.habits.length === 1 ? `${c.what.source}:${c.filter.habits[0]}` : c.filter.habits.length ? 'habits' : c.what.source;
}

export function subjects(c: StatCard, o: Offer): Choice[] {
	const { habits, tasks, metrics } = o.catalog;
	const build = habits.filter((h) => h.direction === 'build' && !h.archived);
	const brk = habits.filter((h) => h.direction === 'break' && !h.archived);
	const taskName = (id: string) => tasks.find((t) => t.id === id)?.name;
	const out: Choice[] = [
		...(build.length ? [{ value: 'outcomes', label: 'Every habit' }, ...build.map((h) => ({ value: `outcomes:${h.id}`, label: h.name }))] : []),
		...tasks.filter((t) => t.logged).map((t) => ({ value: `task:${t.id}`, label: t.name })),
		...(tasks.some((t) => t.logged) ? [{ value: 'tasks', label: 'Every Task' }] : []),
		...metrics.filter((m) => taskName(m.taskId)).map((m) => ({ value: `field:${m.id}`, label: `${m.name} (${taskName(m.taskId)})` })),
		...(brk.length ? [{ value: 'slips', label: 'Slips' }, ...brk.map((h) => ({ value: `slips:${h.id}`, label: `Slips of ${h.name}` })), { value: 'cravings', label: 'Cravings resisted' }] : []),
		...(habits.some((h) => h.hasCost) ? [{ value: 'money', label: 'Money saved' }] : [])
	];
	const now = subjectOf(c);
	// What the sentence can't offer, such as several fields, stays as it is.
	if (!out.some((x) => x.value === now))
		out.unshift({
			value: now,
			label: c.what.name ?? (now === 'fields' ? cardFields(c, o.catalog).map((f) => f.name).join(', ') || 'Several fields' : now === 'habits' ? `${c.filter.habits.length} habits` : (habits.find((h) => c.filter.habits[0] === h.id)?.name ?? 'This'))
		});
	return out;
}

export function slotsOf(c: StatCard, o: Offer): { key: SlotKey; value: string; options: Choice[] }[] {
	// A measure is offered when a card with it would work.
	const fits = perLogChoices(c, o.catalog, o.measures).filter((p) => p === c.perLog || works({ ...c, perLog: p, overTime: defaultOver(p, c, o) }, o));
	const bucket = c.look.chart === 'bars' || c.look.chart === 'line';
	return [
		{ key: 'measure', value: c.perLog, options: [...new Set([c.perLog, ...fits])].map((p) => ({ value: p, label: measureLabel(p, o.measures) })) },
		{ key: 'subject', value: subjectOf(c), options: subjects(c, o) },
		...(bucket
			? [{ key: 'bucket' as const, value: c.bucket, options: (Object.keys(BUCKETS) as StatCard['bucket'][]).filter((b) => b === c.bucket || works({ ...c, bucket: b }, o)).map((b) => ({ value: b, label: b === 'auto' ? 'over time' : b === 'all' ? 'all at once' : b === 'session' ? 'per session' : `per ${BUCKETS[b].toLowerCase()}` })) }]
			: []),
		...(c.look.chart === 'streak' ? [] : [{ key: 'range' as const, value: c.range, options: [{ value: 'page', label: "the board's range" }, ...Object.entries(RANGES).map(([v, l]) => ({ value: v, label: l.toLowerCase() })), ...(c.range.startsWith('since:') ? [{ value: c.range, label: rangeLabel(c.range).toLowerCase() }] : [])] }])
	];
}

// ---------- picking one ----------

function withSubject(c: StatCard, v: string): StatCard {
	const [kind, id] = v.includes(':') ? [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)] : [v, ''];
	const what = { source: c.what.source, metrics: [] as string[], name: null as string | null, taskId: null as string | null };
	const filter = { ...c.filter, habits: [] as string[] };
	if (kind === 'task' || kind === 'tasks') return { ...c, what: { ...what, source: 'task', taskId: id || null }, filter };
	if (kind === 'field') return { ...c, what: { ...what, source: 'field', metrics: [id] }, filter };
	if (kind === 'name' || kind === 'fields' || kind === 'habits') return c;
	return { ...c, what: { ...what, source: kind as StatCard['what']['source'] }, filter: { ...filter, habits: id ? [id] : [] } };
}

const CHART_ORDER: Chart[] = ['line', 'bars', 'tile', 'breakdown', 'calendar', 'table', 'goal', 'records', 'streak', 'sessions', 'pattern'];

/** The card with another chart, and what that chart can't use put right. */
export function withChart(c: StatCard, chart: Chart, o: Offer): StatCard {
	const x: StatCard = { ...c, look: { ...c.look, chart }, compare: { ...c.compare } };
	if (chart === 'tile' || chart === 'calendar') x.split = 'none';
	if (chart === 'calendar' && !['auto', 'day'].includes(x.bucket)) x.bucket = 'auto';
	if (chart === 'line' && x.bucket === 'all') x.bucket = 'auto';
	if (chart === 'breakdown' && x.split === 'none') x.split = x.what.source === 'field' && cardFields(x, o.catalog)[0]?.type === 'choice' ? 'option' : 'habit';
	if (chart !== 'bars') x.look.stacked = false;
	if (chart !== 'bars' && chart !== 'line') x.compare.rolling = 0;
	if (chart === 'tile' && x.look.size === 'full') x.look.size = 'small';
	return x;
}
export const chartsOf = (c: StatCard, o: Offer): Chart[] => (Object.keys(CHARTS) as Chart[]).filter((k) => k === c.look.chart || works(withChart(c, k, o), o));

/**
 * The card after picking a word, with whatever can't live with it moved to the nearest that can,
 * and the sentence that says so. Null when nothing fits.
 */
export function fit(c: StatCard, key: SlotKey, v: string, o: Offer): { card: StatCard; moved: string } | null {
	let x: StatCard =
		key === 'subject' ? withSubject(c, v) : key === 'measure' ? { ...c, perLog: v, overTime: defaultOver(v, c, o) } : key === 'bucket' ? { ...c, bucket: v as StatCard['bucket'] } : { ...c, range: v };
	if (works(x, o)) return { card: x, moved: '' };
	const tries: StatCard[] = [];
	const perLogs = key === 'measure' ? [x.perLog] : [x.perLog, ...perLogChoices(x, o.catalog, o.measures)];
	for (const p of perLogs) {
		const m = p === x.perLog ? x : { ...x, perLog: p, overTime: defaultOver(p, x, o) };
		const plain: StatCard = { ...m, compare: { ...m.compare, goalFromTargets: false, rolling: 0, running: false } };
		for (const base of [m, { ...m, overTime: defaultOver(p, m, o) }, plain, { ...plain, overTime: defaultOver(p, plain, o) }])
			for (const split of [base.split, 'none'] as const)
				for (const chart of [base.look.chart, ...CHART_ORDER]) for (const bucket of [base.bucket, 'auto'] as const) tries.push({ ...withChart({ ...base, split, bucket }, chart, o) });
	}
	const found = tries.find((t) => works(t, o));
	if (!found) return null;
	x = found;
	const name = subjects(x, o).find((s) => s.value === subjectOf(x))?.label ?? 'it';
	const moved = [
		x.perLog !== c.perLog && key !== 'measure' ? `${name} has no ${measureLabel(c.perLog, o.measures).toLowerCase()}, so this is ${measureLabel(x.perLog, o.measures).toLowerCase()} now.` : '',
		x.look.chart !== c.look.chart ? `It is drawn as ${CHARTS[x.look.chart].toLowerCase()} now.` : '',
		x.split !== c.split ? 'It is one series now.' : ''
	]
		.filter(Boolean)
		.join(' ');
	return { card: x, moved };
}

// ---------- what the chart says ----------

/** One sentence that says the point of a chart, for eyes and for screen readers. */
export function pointOf(r: CardResult): string {
	if (r.empty) return '';
	const v = (n: number) => value(n, r.unit, r.kind);
	if ((r.chart === 'bars' || r.chart === 'line') && r.series.length === 1) {
		const at = r.series[0].values.flatMap((n, i) => (n === null ? [] : [{ n, i }]));
		if (at.length < 2) return '';
		const last = at[at.length - 1];
		const top = at.reduce((a, b) => (b.n > a.n ? b : a));
		const label = (i: number) => r.buckets[i]?.label ?? '';
		return `Last ${v(last.n)} (${label(last.i)}).${top.i === last.i ? ' The highest so far.' : ` Highest ${v(top.n)} (${label(top.i)}).`}`;
	}
	if ((r.chart === 'bars' || r.chart === 'line') && r.series.length > 1) {
		const best = [...r.series].filter((s) => s.total !== null && s.key !== 'other').sort((a, b) => b.total! - a.total!)[0];
		return best ? `Most: ${best.label}, ${v(best.total!)}.` : '';
	}
	if (r.breakdown?.length) return `Most: ${r.breakdown[0].label}, ${Math.round(r.breakdown[0].share * 100)}%.`;
	return '';
}
