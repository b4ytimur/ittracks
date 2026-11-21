// The stats engine: turns one card definition and everything an account logged into the
// numbers a chart draws. Pure functions only, so every number is testable and the same code
// runs for the Stats page, a habit's Stats tab, a Task's history and Today's headline numbers.
import { addDays, daysBetween, toDays, fromDays, weekStart, weekday, type ISODate } from '../engine/dates';
import { daysSinceSlip, longestRun, streak, type Level, type Mark, type StreakRule } from '../engine/streak';
import { chainCells } from '../engine/chain';
import { withinOn, withinStreak, usedIn, limitOn, type Limit } from '../engine/limit';
import { compile, evaluate, FormulaError } from './formula';
import {
	ADDS_UP,
	SHARE_MEASURES,
	customId,
	isCustom,
	type BoardFilter,
	type Bucket,
	type CustomMeasure,
	type OverTime,
	type StatCard,
	type StatsSettings
} from './model';

// ---------- what the engine reads ----------

export type Values = Record<string, unknown>;

export interface DsHabit {
	id: string;
	name: string;
	direction: 'build' | 'break';
	areaId: string | null;
	startDate: ISODate;
	archived: boolean;
	identities: string[];
	cost: { amount: number; unit: string; perDay: number | null } | null;
	streakRule: StreakRule;
	minimumCounts: boolean;
	/** Reduce mode: slips are allowed up to a daily or weekly limit. */
	limit: Limit | null;
}
export interface DsTask {
	id: string;
	name: string;
	areaId: string | null;
	parentTaskId: string | null;
	archived: boolean;
	/** level: 1 low, 2 medium, 3 high */
	tags: { name: string; level: number }[];
}
export interface DsMetric {
	id: string;
	taskId: string;
	name: string;
	type: string;
	unit: string | null;
	repeats: boolean;
	choices: string[] | null;
}
export interface DsVariant {
	id: string;
	habitId: string;
	name: string;
}
export interface DsSlot {
	id: string;
	variantId: string;
	taskId: string | null;
	sets: number | null;
	targets: Record<string, number> | null;
	minTargets: Record<string, number> | null;
	stretchTargets: Record<string, number> | null;
}
export interface DsOcc {
	id: string;
	habitId: string;
	variantId: string | null;
	date: ISODate;
	status: 'due' | 'done' | 'skipped' | 'missed';
	level: Level | null;
	picks: Record<string, string> | null;
	/** HH:MM it was finished, in the user's time zone. */
	time: string | null;
}
export interface DsEntry {
	occurrenceId: string;
	taskId: string;
	values: Values;
	sortOrder: number;
}
export interface DsSlip {
	habitId: string;
	date: ISODate;
	count: number;
	time: string | null;
}
export interface DsCraving {
	habitId: string;
	date: ISODate;
	time: string | null;
}
export interface Dataset {
	today: ISODate;
	weightUnit: string;
	ranges: { name: string; start: string; end: string }[];
	areas: { id: string; name: string }[];
	habits: DsHabit[];
	tasks: DsTask[];
	metrics: DsMetric[];
	variants: DsVariant[];
	slots: DsSlot[];
	occurrences: DsOcc[];
	entries: DsEntry[];
	slips: DsSlip[];
	cravings: DsCraving[];
}

/** One Task inside one finished Occurrence: its sets, its once-per-log values and its sub-task ticks. */
export interface Log {
	occ: DsOcc;
	habit: DsHabit;
	task: DsTask;
	sets: Values[];
	single: Values;
	subsTotal: number;
	subsDone: number;
	slot: DsSlot | null;
}

export interface Roles {
	weight: DsMetric | null;
	reps: DsMetric | null;
	distance: DsMetric | null;
	time: DsMetric | null;
}

export interface Prepared {
	ds: Dataset;
	habits: Map<string, DsHabit>;
	tasks: Map<string, DsTask>;
	metrics: Map<string, DsMetric>;
	metricsByTask: Map<string, DsMetric[]>;
	variants: Map<string, DsVariant>;
	slotsByVariant: Map<string, DsSlot[]>;
	occsByHabit: Map<string, DsOcc[]>;
	logs: Log[];
	logsByTask: Map<string, Log[]>;
	roles: Map<string, Roles>;
	/** First date anything was logged. */
	earliest: ISODate;
}

const group = <T, K>(xs: T[], key: (x: T) => K) => {
	const m = new Map<K, T[]>();
	for (const x of xs) {
		const k = key(x);
		const list = m.get(k);
		if (list) list.push(x);
		else m.set(k, [x]);
	}
	return m;
};

export function num(v: unknown): number | null {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
	return null;
}

const filled = (v: unknown) => v !== null && v !== undefined && v !== '' && v !== false;

export function rolesOf(metrics: DsMetric[]): Roles {
	const rep = metrics.filter((m) => m.repeats);
	const unit = (m: DsMetric) => (m.unit ?? '').trim().toLowerCase();
	const weight =
		rep.find((m) => m.type === 'number' && (['kg', 'lb', 'lbs'].includes(unit(m)) || /weight|load/i.test(m.name))) ?? null;
	const reps = rep.find((m) => m.type === 'count' && /rep/i.test(m.name)) ?? rep.find((m) => m.type === 'count') ?? null;
	const distance =
		metrics.find((m) => m.type === 'number' && (['km', 'mi', 'mile', 'miles', 'm'].includes(unit(m)) || /distance/i.test(m.name))) ?? null;
	const time = metrics.find((m) => m.type === 'duration') ?? null;
	return { weight, reps, distance, time };
}

export function prepare(ds: Dataset): Prepared {
	const habits = new Map(ds.habits.map((h) => [h.id, h]));
	const tasks = new Map(ds.tasks.map((t) => [t.id, t]));
	const metrics = new Map(ds.metrics.map((m) => [m.id, m]));
	const metricsByTask = group(ds.metrics, (m) => m.taskId);
	const variants = new Map(ds.variants.map((v) => [v.id, v]));
	const slotsByVariant = group(ds.slots, (s) => s.variantId);
	const occsByHabit = group(
		[...ds.occurrences].sort((a, b) => a.date.localeCompare(b.date)),
		(o) => o.habitId
	);
	const occs = new Map(ds.occurrences.map((o) => [o.id, o]));
	const subsOf = group(
		ds.tasks.filter((t) => t.parentTaskId && !t.archived),
		(t) => t.parentTaskId!
	);

	const logsByKey = new Map<string, Log>();
	const logFor = (o: DsOcc, t: DsTask) => {
		const k = `${o.id}|${t.id}`;
		let l = logsByKey.get(k);
		if (!l) {
			const slots = o.variantId ? (slotsByVariant.get(o.variantId) ?? []) : [];
			l = {
				occ: o,
				habit: habits.get(o.habitId)!,
				task: t,
				sets: [],
				single: {},
				subsTotal: subsOf.get(t.id)?.length ?? 0,
				subsDone: 0,
				slot: slots.find((s) => (o.picks?.[s.id] ?? s.taskId) === t.id) ?? null
			};
			logsByKey.set(k, l);
		}
		return l;
	};
	for (const e of [...ds.entries].sort((a, b) => a.sortOrder - b.sortOrder)) {
		const o = occs.get(e.occurrenceId);
		const t = tasks.get(e.taskId);
		if (!o || !t || o.status !== 'done' || !habits.has(o.habitId)) continue;
		if (t.parentTaskId) {
			const parent = tasks.get(t.parentTaskId);
			if (parent) logFor(o, parent).subsDone++;
			continue;
		}
		const l = logFor(o, t);
		if (e.values._summary) Object.assign(l.single, e.values);
		else if (Object.keys(e.values).some((k) => (metrics.get(k)?.repeats ?? false))) l.sets.push(e.values);
		else Object.assign(l.single, e.values);
	}
	const logs = [...logsByKey.values()].sort((a, b) => a.occ.date.localeCompare(b.occ.date));
	const roles = new Map([...metricsByTask.entries()].map(([k, ms]) => [k, rolesOf(ms)]));
	const dates = [
		...ds.occurrences.filter((o) => o.status !== 'due').map((o) => o.date),
		...ds.slips.map((s) => s.date),
		...ds.cravings.map((c) => c.date),
		...ds.habits.filter((h) => h.direction === 'break').map((h) => h.startDate)
	].sort();
	return {
		ds,
		habits,
		tasks,
		metrics,
		metricsByTask,
		variants,
		slotsByVariant,
		occsByHabit,
		logs,
		logsByTask: group(logs, (l) => l.task.id),
		roles,
		earliest: dates[0] ?? addDays(ds.today, -29)
	};
}

// ---------- units ----------

const UNITS: Record<string, { dim: string; f: number }> = {
	s: { dim: 't', f: 1 / 60 },
	sec: { dim: 't', f: 1 / 60 },
	secs: { dim: 't', f: 1 / 60 },
	seconds: { dim: 't', f: 1 / 60 },
	min: { dim: 't', f: 1 },
	mins: { dim: 't', f: 1 },
	minute: { dim: 't', f: 1 },
	minutes: { dim: 't', f: 1 },
	h: { dim: 't', f: 60 },
	hr: { dim: 't', f: 60 },
	hrs: { dim: 't', f: 60 },
	hour: { dim: 't', f: 60 },
	hours: { dim: 't', f: 60 },
	g: { dim: 'w', f: 0.001 },
	kg: { dim: 'w', f: 1 },
	lb: { dim: 'w', f: 0.45359237 },
	lbs: { dim: 'w', f: 0.45359237 },
	m: { dim: 'd', f: 0.001 },
	km: { dim: 'd', f: 1 },
	mi: { dim: 'd', f: 1.609344 },
	mile: { dim: 'd', f: 1.609344 },
	miles: { dim: 'd', f: 1.609344 }
};
const unitKey = (u: string | null) => (u ?? '').trim().toLowerCase();

/** Can values in `a` be added to values in `b`? Same unit, or both known units of one kind. */
export function convertible(a: string | null, b: string | null): boolean {
	const x = unitKey(a);
	const y = unitKey(b);
	if (x === y) return true;
	return !!UNITS[x] && !!UNITS[y] && UNITS[x].dim === UNITS[y].dim;
}

export function convert(v: number, from: string | null, to: string | null): number {
	const x = UNITS[unitKey(from)];
	const y = UNITS[unitKey(to)];
	if (!x || !y || x.dim !== y.dim || unitKey(from) === unitKey(to)) return v;
	return (v * x.f) / y.f;
}

// ---------- ranges and buckets ----------

export interface Range {
	from: ISODate;
	to: ISODate;
}

const monthStart = (d: ISODate) => `${d.slice(0, 7)}-01`;
const lastOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function shiftMonths(d: ISODate, n: number): ISODate {
	const y = Number(d.slice(0, 4));
	const m = Number(d.slice(5, 7)) - 1 + n;
	const yy = y + Math.floor(m / 12);
	const mm = ((m % 12) + 12) % 12;
	const day = Math.min(Number(d.slice(8, 10)), lastOfMonth(yy, mm + 1));
	return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function resolveRange(r: string, today: ISODate, earliest: ISODate): Range {
	if (r.startsWith('since:')) {
		const from = r.slice(6);
		return { from: from > today ? today : from, to: today };
	}
	switch (r) {
		case 'week':
			return { from: weekStart(today), to: today };
		case '7d':
			return { from: addDays(today, -6), to: today };
		case 'month':
			return { from: monthStart(today), to: today };
		case '90d':
			return { from: addDays(today, -89), to: today };
		case 'year':
			return { from: `${today.slice(0, 4)}-01-01`, to: today };
		case '12m':
			return { from: addDays(shiftMonths(today, -12), 1), to: today };
		case 'all':
			return { from: earliest < today ? earliest : addDays(today, -29), to: today };
		default:
			return { from: addDays(today, -29), to: today };
	}
}

/** The period just before: the same days of last week, month or year, or the same length for rolling ranges. */
export function previousRange(r: string, cur: Range): Range {
	if (r === 'week') return { from: addDays(cur.from, -7), to: addDays(cur.to, -7) };
	if (r === 'month') return { from: shiftMonths(cur.from, -1), to: shiftMonths(cur.to, -1) };
	if (r === 'year') return { from: shiftMonths(cur.from, -12), to: shiftMonths(cur.to, -12) };
	const len = daysBetween(cur.from, cur.to) + 1;
	return { from: addDays(cur.from, -len), to: addDays(cur.from, -1) };
}

/** T4: day up to 31 days, week up to about 6 months, month beyond. */
export function autoBucket(range: Range): 'day' | 'week' | 'month' {
	const len = daysBetween(range.from, range.to) + 1;
	return len <= 31 ? 'day' : len <= 186 ? 'week' : 'month';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (d: ISODate) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

export interface BucketInfo {
	key: string;
	label: string;
	from: ISODate;
	to: ISODate;
}

export function bucketOf(d: ISODate, b: Exclude<Bucket, 'auto' | 'session'>): { key: string; from: ISODate; to: ISODate } {
	switch (b) {
		case 'day':
			return { key: d, from: d, to: d };
		case 'week': {
			const s = weekStart(d);
			return { key: s, from: s, to: addDays(s, 6) };
		}
		case 'month': {
			const s = monthStart(d);
			return { key: s.slice(0, 7), from: s, to: addDays(shiftMonths(s, 1), -1) };
		}
		case 'quarter': {
			const q = Math.floor((Number(d.slice(5, 7)) - 1) / 3);
			const s = `${d.slice(0, 4)}-${String(q * 3 + 1).padStart(2, '0')}-01`;
			return { key: `${d.slice(0, 4)}-Q${q + 1}`, from: s, to: addDays(shiftMonths(s, 3), -1) };
		}
		case 'year':
			return { key: d.slice(0, 4), from: `${d.slice(0, 4)}-01-01`, to: `${d.slice(0, 4)}-12-31` };
		default:
			return { key: 'all', from: '0000-01-01', to: '9999-12-31' };
	}
}

function bucketLabel(k: { key: string; from: ISODate }, b: Exclude<Bucket, 'auto' | 'session'>, sameYear: boolean): string {
	if (b === 'day' || b === 'week') return shortDate(k.from);
	if (b === 'month') return sameYear ? MONTHS[Number(k.from.slice(5, 7)) - 1] : `${MONTHS[Number(k.from.slice(5, 7)) - 1]} ${k.from.slice(2, 4)}`;
	if (b === 'quarter') return k.key.slice(5) + (sameYear ? '' : ` ${k.key.slice(2, 4)}`);
	if (b === 'year') return k.key;
	return 'All';
}

export function bucketList(range: Range, b: Exclude<Bucket, 'auto' | 'session'>): BucketInfo[] {
	if (b === 'all') return [{ key: 'all', label: 'Whole range', from: range.from, to: range.to }];
	const out: BucketInfo[] = [];
	const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
	let d = range.from;
	let guard = 0;
	while (d <= range.to && guard++ < 1000) {
		const k = bucketOf(d, b);
		out.push({ key: k.key, label: bucketLabel(k, b, sameYear), from: k.from < range.from ? range.from : k.from, to: k.to > range.to ? range.to : k.to });
		d = addDays(k.to, 1);
	}
	return out;
}

// ---------- points ----------

export interface SeriesTag {
	key: string;
	label: string;
	w: number;
	order: number;
}

/** One number from one log (or one slip, or one day of savings), with the series it belongs to. */
export interface Point {
	date: ISODate;
	value: number;
	series: SeriesTag[];
	occId: string | null;
	habitId: string;
	taskId: string | null;
	time: string | null;
}

export interface Ctx {
	today: ISODate;
	boardRange: string;
	boardFilter: BoardFilter;
	settings: Pick<StatsSettings, 'muscle' | 'e1rm' | 'e1rmMaxReps' | 'measures'>;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LEVEL_ORDER: Record<string, number> = { minimum: 0, target: 1, stretch: 2 };
const LEVEL_LABEL: Record<string, string> = { minimum: 'Minimum', target: 'Target', stretch: 'Stretch' };
const DEFAULT_PARTS = [
	{ name: 'Night', start: '00:00', end: '06:00' },
	{ name: 'Morning', start: '06:00', end: '12:00' },
	{ name: 'Afternoon', start: '12:00', end: '18:00' },
	{ name: 'Evening', start: '18:00', end: '24:00' }
];
export const partsOf = (ds: Dataset) => (ds.ranges.length ? ds.ranges : DEFAULT_PARTS);
function partIndex(parts: { start: string; end: string }[], time: string): number {
	return parts.findIndex((r) => (r.start <= r.end ? time >= r.start && time < r.end : time >= r.start || time < r.end));
}

/** Which habits and Tasks a card looks at. */
export function scope(card: StatCard, P: Prepared, ctx: Ctx) {
	const bf = ctx.boardFilter;
	const cf = card.filter;
	const areas = [bf.areas, cf.areas].filter((a) => a.length);
	const tags = [...new Set([...bf.tags, ...cf.tags])].map((t) => t.toLowerCase());
	const habitOk = (h: DsHabit) =>
		(!bf.habit || h.id === bf.habit) &&
		(!cf.habits.length || cf.habits.includes(h.id)) &&
		(!bf.identity || h.identities.includes(bf.identity)) &&
		(bf.direction === 'all' || h.direction === bf.direction);
	const areaOk = (h: DsHabit, t: DsTask | null) =>
		areas.every((a) => a.includes(h.areaId ?? '') || (!!t && a.includes(t.areaId ?? '')));
	const tagOk = (t: DsTask | null) => !tags.length || (!!t && t.tags.some((x) => tags.includes(x.name.toLowerCase())));
	/** Tasks a habit's Variants use, for tag filters on habit outcomes. */
	const habitTasks = (h: DsHabit) =>
		P.ds.variants
			.filter((v) => v.habitId === h.id)
			.flatMap((v) => P.slotsByVariant.get(v.id) ?? [])
			.map((s) => (s.taskId ? P.tasks.get(s.taskId) : undefined))
			.filter((t): t is DsTask => !!t);
	const logOk = (l: { habit: DsHabit; task: DsTask }) => habitOk(l.habit) && areaOk(l.habit, l.task) && tagOk(l.task);
	const habitOnlyOk = (h: DsHabit) => habitOk(h) && areaOk(h, null) && (!tags.length || habitTasks(h).some(tagOk));
	return { habitOk, areaOk, tagOk, logOk, habitOnlyOk };
}

/** The fields a field card reads, all in one unit (the first one found). */
export function fieldsFor(card: StatCard, P: Prepared, ctx: Ctx): { metrics: DsMetric[]; unit: string | null; left: string[] } {
	const sc = scope(card, P, ctx);
	let ms: DsMetric[];
	if (card.what.metrics.length) ms = card.what.metrics.map((id) => P.metrics.get(id)).filter((m): m is DsMetric => !!m);
	else if (card.what.name) {
		const n = card.what.name.trim().toLowerCase();
		ms = P.ds.metrics.filter((m) => m.name.trim().toLowerCase() === n);
		ms = ms.filter((m) => {
			const t = P.tasks.get(m.taskId);
			return !!t && !t.archived && sc.tagOk(t);
		});
	} else ms = [];
	if (!ms.length) return { metrics: [], unit: null, left: [] };
	const type = ms[0].type;
	const unit = ms[0].unit;
	const left: string[] = [];
	const keep = ms.filter((m) => {
		const ok = m.type === type && convertible(m.unit, unit);
		if (!ok) left.push(`${m.name} in ${P.tasks.get(m.taskId)?.name ?? 'a Task'} (${m.unit || m.type}) can't be added to ${unit || type} and was left out`);
		return ok;
	});
	return { metrics: keep, unit, left };
}

function splitTags(card: StatCard, P: Prepared, ctx: Ctx, l: { habit: DsHabit; task: DsTask | null; occ: DsOcc | null; date: ISODate; time: string | null }): SeriesTag[] {
	const one = (key: string, label: string, order = 0): SeriesTag[] => [{ key, label, w: 1, order }];
	switch (card.split) {
		case 'habit':
			return one(l.habit.id, l.habit.name);
		case 'task':
			return l.task ? one(l.task.id, l.task.name) : one('none', 'No Task', 1e9);
		case 'area': {
			const id = l.task?.areaId ?? l.habit.areaId;
			const a = id ? P.ds.areas.find((x) => x.id === id) : null;
			return a ? one(a.id, a.name) : one('none', 'No area', 1e9);
		}
		case 'variant': {
			const v = l.occ?.variantId ? P.variants.get(l.occ.variantId) : null;
			return v ? one(v.id, v.name) : one('none', 'No Variant', 1e9);
		}
		case 'level': {
			const lv = l.occ?.level ?? 'target';
			return one(lv, LEVEL_LABEL[lv], LEVEL_ORDER[lv]);
		}
		case 'weekday': {
			const w = weekday(l.date);
			return one(String(w), WEEKDAYS[w], w);
		}
		case 'part': {
			if (!l.time) return one('none', 'No time', 1e9);
			const parts = partsOf(P.ds);
			const i = partIndex(parts, l.time);
			return i < 0 ? one('none', 'Other times', 1e8) : one(`p${i}`, parts[i].name, i);
		}
		case 'tag': {
			if (!l.task || !l.task.tags.length) return one('none', 'No tag', 1e9);
			const weighted = ['hardSets', 'volume'].includes(card.perLog);
			const wOf = (lv: number) => (lv >= 3 ? ctx.settings.muscle.high : lv === 2 ? ctx.settings.muscle.medium : ctx.settings.muscle.low);
			const tags = l.task.tags
				.map((t) => ({ key: `t:${t.name.toLowerCase()}`, label: t.name, w: weighted ? wOf(t.level) : 1, order: 0 }))
				.filter((t) => t.w > 0);
			return tags.length ? tags : one('none', 'No tag', 1e9);
		}
		default:
			return one('all', '', 0);
	}
}

/** The targets for the level reached, and how many sets were planned. */
function targetsFor(l: Log): { targets: Record<string, number>; sets: number | null } | null {
	if (!l.slot) return null;
	const lv = l.occ.level ?? 'target';
	const t =
		lv === 'minimum' && l.slot.minTargets && Object.keys(l.slot.minTargets).length
			? l.slot.minTargets
			: lv === 'stretch' && l.slot.stretchTargets && Object.keys(l.slot.stretchTargets).length
				? l.slot.stretchTargets
				: l.slot.targets;
	if (!t || !Object.keys(t).length) return null;
	return { targets: t, sets: l.slot.sets };
}

/** 1 when every target was reached (and every sub-task ticked), 0.5 when some were, 0 when none. Null with nothing to compare. */
export function targetMetOfLog(l: Log, P: Prepared): number | null {
	const results: number[] = [];
	const t = targetsFor(l);
	if (t) {
		for (const [mid, goal] of Object.entries(t.targets)) {
			const m = P.metrics.get(mid);
			if (!m || goal === null || goal === undefined) continue;
			if (m.repeats) {
				const need = t.sets ?? 1;
				const hits = l.sets.filter((s) => (num(s[mid]) ?? -Infinity) >= goal).length;
				results.push(hits >= need ? 1 : hits > 0 ? 0.5 : 0);
			} else {
				const v = num(l.single[mid]);
				results.push(v !== null && v >= goal ? 1 : v !== null && v > 0 ? 0.5 : 0);
			}
		}
	}
	if (l.subsTotal > 0) results.push(l.subsDone >= l.subsTotal ? 1 : l.subsDone > 0 ? 0.5 : 0);
	if (!results.length) return null;
	return results.every((r) => r === 1) ? 1 : results.every((r) => r === 0) ? 0 : 0.5;
}

export function targetMetOfOcc(o: DsOcc, P: Prepared): number | null {
	const logs = (P.logs as Log[]).filter((l) => l.occ.id === o.id);
	const slots = o.variantId ? (P.slotsByVariant.get(o.variantId) ?? []) : [];
	const rs: number[] = [];
	for (const l of logs) {
		const r = targetMetOfLog(l, P);
		if (r !== null) rs.push(r);
	}
	// A Slot with targets that has nothing logged at all counts as not reached.
	for (const s of slots) {
		const taskId = o.picks?.[s.id] ?? s.taskId;
		const hasTargets = !!s.targets && Object.keys(s.targets).length > 0;
		if (hasTargets && !logs.some((l) => l.task.id === taskId)) rs.push(0);
	}
	if (!rs.length) return null;
	return rs.every((r) => r === 1) ? 1 : rs.every((r) => r === 0) ? 0 : 0.5;
}

function measureOf(id: string, ms: CustomMeasure[]) {
	return ms.find((m) => m.id === id) ?? null;
}

/** A field's value in a set (or the log) by name, with Weight and Reps falling back to the detected fields. */
function fieldLookup(l: Log, P: Prepared, set: Values | null, mode: 'set' | 'log') {
	const ms = P.metricsByTask.get(l.task.id) ?? [];
	const roles = P.roles.get(l.task.id);
	return (name: string): number | null => {
		const n = name.trim().toLowerCase();
		let m = ms.find((x) => x.name.trim().toLowerCase() === n);
		if (!m && n === 'weight') m = roles?.weight ?? undefined;
		if (!m && n === 'reps') m = roles?.reps ?? undefined;
		if (!m) return null;
		if (m.repeats) {
			if (mode === 'set') return set ? num(set[m.id]) : null;
			const vs = l.sets.map((s) => num(s[m!.id])).filter((v): v is number => v !== null);
			return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
		}
		if (m.type === 'checkbox') return l.single[m.id] === true ? 1 : 0;
		return num(l.single[m.id]);
	};
}

/** e1RM of one set under the user's formula. */
function e1rmOf(set: Values, l: Log, P: Prepared, ctx: Ctx): number | null {
	const r = P.roles.get(l.task.id);
	if (!r?.weight || !r.reps) return null;
	const w = num(set[r.weight.id]);
	const reps = num(set[r.reps.id]);
	if (w === null || reps === null || reps < 1 || w <= 0 || reps > ctx.settings.e1rmMaxReps) return null;
	const f = compile(ctx.settings.e1rm);
	if (f instanceof FormulaError) return null;
	const v = evaluate(f, (name) => {
		const n = name.trim().toLowerCase();
		if (n === 'weight') return w;
		if (n === 'reps') return reps;
		return fieldLookup(l, P, set, 'set')(name);
	});
	return v === null ? null : convert(v, r.weight.unit, P.ds.weightUnit);
}

/** The number one log gives for a Task measure. */
export function taskValue(perLog: string, l: Log, P: Prepared, ctx: Ctx): number | null {
	const r = P.roles.get(l.task.id) ?? { weight: null, reps: null, distance: null, time: null };
	const repIds = (P.metricsByTask.get(l.task.id) ?? []).filter((m) => m.repeats).map((m) => m.id);
	const doneSets = l.sets.filter((s) => repIds.some((id) => filled(s[id])));
	switch (perLog) {
		case 'volume': {
			if (!r.weight || !r.reps) return null;
			let v = 0;
			let any = false;
			for (const s of doneSets) {
				const w = num(s[r.weight.id]);
				const n = num(s[r.reps.id]);
				if (w !== null && n !== null) {
					v += convert(w, r.weight.unit, P.ds.weightUnit) * n;
					any = true;
				}
			}
			return any ? v : null;
		}
		case 'e1rm': {
			const vs = doneSets.map((s) => e1rmOf(s, l, P, ctx)).filter((v): v is number => v !== null);
			return vs.length ? Math.max(...vs) : null;
		}
		case 'hardSets':
		case 'sets':
			return repIds.length ? doneSets.length || null : null;
		case 'pace': {
			if (!r.time || !r.distance) return null;
			const t = fieldLookup(l, P, null, 'log')(r.time.name);
			const d = fieldLookup(l, P, null, 'log')(r.distance.name);
			return t !== null && d ? convert(t, r.time.unit || 'min', 'min') / d : null;
		}
		case 'pctTarget': {
			const t = targetsFor(l);
			if (!t) return null;
			const parts: number[] = [];
			for (const [mid, goal] of Object.entries(t.targets)) {
				const m = P.metrics.get(mid);
				if (!m || !(goal > 0)) continue;
				if (m.repeats) {
					const need = t.sets ?? 1;
					const got = l.sets.reduce((a, s) => a + Math.min(num(s[mid]) ?? 0, goal), 0);
					parts.push(Math.min(got / (goal * need), 1.5));
				} else parts.push(Math.min((num(l.single[mid]) ?? 0) / goal, 1.5));
			}
			return parts.length ? (parts.reduce((a, b) => a + b, 0) / parts.length) * 100 : null;
		}
		case 'targetMet':
			return targetMetOfLog(l, P);
		default: {
			if (!isCustom(perLog)) return null;
			const m = measureOf(customId(perLog), ctx.settings.measures);
			if (!m) return null;
			const f = compile(m.formula);
			if (f instanceof FormulaError) return null;
			if (m.per === 'log' || !doneSets.length) return evaluate(f, fieldLookup(l, P, null, 'log'));
			const vs = doneSets.map((s) => evaluate(f, fieldLookup(l, P, s, 'set'))).filter((v): v is number => v !== null);
			if (!vs.length) return null;
			if (m.combine === 'max') return Math.max(...vs);
			if (m.combine === 'avg') return vs.reduce((a, b) => a + b, 0) / vs.length;
			return vs.reduce((a, b) => a + b, 0);
		}
	}
}

/** Every number a card reads in a range, one per log (or per set, slip or day). */
export function pointsFor(card: StatCard, P: Prepared, ctx: Ctx, range: Range): Point[] {
	const sc = scope(card, P, ctx);
	const inRange = (d: ISODate) => d >= range.from && d <= range.to && d <= ctx.today;
	const out: Point[] = [];
	const src = card.what.source;
	const tagsFor = (l: { habit: DsHabit; task: DsTask | null; occ: DsOcc | null; date: ISODate; time: string | null }) =>
		splitTags(card, P, ctx, l);

	if (src === 'outcomes') {
		for (const h of P.ds.habits) {
			if (h.direction !== 'build' || !sc.habitOnlyOk(h)) continue;
			for (const o of P.occsByHabit.get(h.id) ?? []) {
				if (!inRange(o.date) || o.status === 'due') continue;
				let v: number | null = null;
				if (card.perLog === 'done') v = o.status === 'done' ? 1 : null;
				else if (card.perLog === 'rate') v = o.status === 'done' ? 1 : o.status === 'missed' ? 0 : null;
				else if (card.perLog === 'targetMet') v = o.status === 'done' ? targetMetOfOcc(o, P) : null;
				if (v === null) continue;
				out.push({ date: o.date, value: v, series: tagsFor({ habit: h, task: null, occ: o, date: o.date, time: o.time }), occId: o.id, habitId: h.id, taskId: null, time: o.time });
			}
		}
		return out;
	}

	if (src === 'field') {
		const { metrics, unit } = fieldsFor(card, P, ctx);
		for (const m of metrics) {
			for (const l of P.logsByTask.get(m.taskId) ?? []) {
				if (!inRange(l.occ.date) || !sc.logOk(l)) continue;
				const base = { habit: l.habit, task: l.task, occ: l.occ, date: l.occ.date, time: l.occ.time };
				const push = (value: number, series = tagsFor(base)) =>
					out.push({ date: l.occ.date, value, series, occId: l.occ.id, habitId: l.habit.id, taskId: l.task.id, time: l.occ.time });
				const conv = (v: number) => convert(v, m.unit, unit);
				const fieldSeries = (): SeriesTag[] => [{ key: `f:${m.name.toLowerCase()}`, label: m.name, w: 1, order: card.what.metrics.indexOf(m.id) }];
				const series = card.split === 'field' ? fieldSeries() : undefined;
				if (m.repeats) {
					const vals = l.sets.map((s) => (m.type === 'checkbox' ? (s[m.id] === true ? 1 : 0) : num(s[m.id])));
					const nums = vals.filter((v): v is number => v !== null);
					if (card.split === 'set') {
						vals.forEach((v, i) => v !== null && push(conv(v), [{ key: `s${i}`, label: `Set ${i + 1}`, w: 1, order: i }]));
						continue;
					}
					if (!nums.length) continue;
					const v =
						card.perLog === 'best'
							? Math.max(...nums)
							: card.perLog === 'avg'
								? nums.reduce((a, b) => a + b, 0) / nums.length
								: card.perLog === 'sets'
									? nums.length
									: card.perLog === 'ticked'
										? nums.filter((x) => x > 0).length / nums.length
										: nums.reduce((a, b) => a + b, 0);
					push(card.perLog === 'sets' || card.perLog === 'ticked' ? v : conv(v), series);
				} else {
					const raw = l.single[m.id];
					if (card.perLog === 'ticked') {
						push(raw === true ? 1 : 0, series);
					} else if (card.perLog === 'option') {
						if (typeof raw === 'string' && raw) push(1, card.split === 'option' || card.split === 'none' ? [{ key: `o:${raw}`, label: raw, w: 1, order: m.choices?.indexOf(raw) ?? 0 }] : tagsFor(base));
					} else if (card.perLog === 'present') {
						if (filled(raw)) push(1, series);
					} else {
						const v = m.type === 'checkbox' ? (raw === true ? 1 : raw === false ? 0 : null) : num(raw);
						if (v !== null) push(m.type === 'checkbox' ? v : conv(v), series);
					}
				}
			}
		}
		return out;
	}

	if (src === 'task') {
		const tasks = card.what.taskId ? [P.tasks.get(card.what.taskId)].filter((t): t is DsTask => !!t) : P.ds.tasks.filter((t) => !t.parentTaskId);
		for (const t of tasks) {
			for (const l of P.logsByTask.get(t.id) ?? []) {
				if (!inRange(l.occ.date) || !sc.logOk(l)) continue;
				const v = taskValue(card.perLog, l, P, ctx);
				if (v === null) continue;
				out.push({
					date: l.occ.date,
					value: v,
					series: tagsFor({ habit: l.habit, task: l.task, occ: l.occ, date: l.occ.date, time: l.occ.time }),
					occId: l.occ.id,
					habitId: l.habit.id,
					taskId: t.id,
					time: l.occ.time
				});
			}
		}
		return out;
	}

	if (src === 'slips' || src === 'cravings') {
		const rows = src === 'slips' ? P.ds.slips : P.ds.cravings.map((c) => ({ ...c, count: 1 }));
		for (const s of rows) {
			const h = P.habits.get(s.habitId);
			if (!h || !sc.habitOnlyOk(h) || !inRange(s.date)) continue;
			out.push({ date: s.date, value: s.count, series: tagsFor({ habit: h, task: null, occ: null, date: s.date, time: s.time }), occId: null, habitId: h.id, taskId: null, time: s.time });
		}
		return out;
	}

	if (src === 'money') {
		const slipsBy = group(P.ds.slips, (s) => `${s.habitId}|${s.date}`);
		for (const h of P.ds.habits) {
			if (h.direction !== 'break' || !h.cost?.perDay || !sc.habitOnlyOk(h)) continue;
			// Only finished days count, so today doesn't count before it ends.
			const from = h.startDate > range.from ? h.startDate : range.from;
			const to = addDays(ctx.today, -1) < range.to ? addDays(ctx.today, -1) : range.to;
			for (let d = from; d <= to; d = addDays(d, 1)) {
				const n = (slipsBy.get(`${h.id}|${d}`) ?? []).reduce((a, s) => a + s.count, 0);
				out.push({ date: d, value: h.cost.perDay - n * h.cost.amount, series: tagsFor({ habit: h, task: null, occ: null, date: d, time: null }), occId: null, habitId: h.id, taskId: null, time: null });
			}
		}
	}
	return out;
}

// ---------- combining ----------

type WV = { v: number; w: number; date: ISODate };

/** Sums and counts of nothing are 0; an average or a best of nothing is no number. */
export function combine(xs: WV[], how: OverTime): number | null {
	const ys = xs.filter((x) => x.w > 0);
	if (!ys.length) return ADDS_UP.includes(how) ? 0 : null;
	switch (how) {
		case 'sum':
			return ys.reduce((a, x) => a + x.v * x.w, 0);
		case 'avg': {
			const w = ys.reduce((a, x) => a + x.w, 0);
			return w ? ys.reduce((a, x) => a + x.v * x.w, 0) / w : null;
		}
		case 'median': {
			const s = ys.map((x) => x.v).sort((a, b) => a - b);
			const m = Math.floor(s.length / 2);
			return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
		}
		case 'min':
			return Math.min(...ys.map((x) => x.v));
		case 'max':
			return Math.max(...ys.map((x) => x.v));
		case 'last': {
			const latest = ys.reduce((a, x) => (x.date >= a.date ? x : a), ys[0]);
			return latest.v;
		}
		case 'count':
			return ys.reduce((a, x) => a + x.w, 0);
		case 'days':
			return new Set(ys.map((x) => x.date)).size;
	}
}

const wvOf = (p: Point, key: string | null): WV | null => {
	if (key === null) return { v: p.value, w: Math.max(...p.series.map((s) => s.w), 0) || (p.series.length ? 0 : 1), date: p.date };
	const s = p.series.find((x) => x.key === key);
	return s ? { v: p.value, w: s.w, date: p.date } : null;
};

/** Combined over every series. A set that counts toward two tags is counted once here. */
const allOf = (ps: Point[]): WV[] => ps.map((p) => ({ v: p.value, w: 1, date: p.date }));

// ---------- results ----------

export type ValueKind = 'number' | 'duration' | 'percent' | 'count';

export interface SeriesOut {
	key: string;
	label: string;
	values: (number | null)[];
	total: number | null;
}

export interface CardResult {
	chart: StatCard['look']['chart'];
	range: Range;
	unit: string;
	kind: ValueKind;
	empty: boolean;
	notes: string[];
	total: number | null;
	previousTotal: number | null;
	buckets: BucketInfo[];
	series: SeriesOut[];
	previous: (number | null)[] | null;
	rolling: (number | null)[] | null;
	goal: { min: number; max: number | null } | null;
	days?: { date: ISODate; value: number | null; status: string | null }[];
	records?: { label: string; value: number; unit: string; kind: ValueKind; date: ISODate | null; occId: string | null }[];
	rows?: { key: string; label: string; total: number | null; best: number | null; last: number | null; lastDate: ISODate | null; logs: number }[];
	grid?: { rows: string[]; cols: string[]; values: (number | null)[][] };
	sessions?: { date: ISODate; occId: string; habit: string; task: string; text: string; met: number | null }[];
	streaks?: { habitId: string; name: string; current: number; unit: 'streak' | 'percent' | 'days' | 'withinDays' | 'withinWeeks'; best: number | null; atRisk: boolean; strip: { date: ISODate; status: string }[] }[];
	goalRows?: { key: string; label: string; value: number | null; goal: number | null; goalMax: number | null; period: string }[];
	breakdown?: { key: string; label: string; value: number; share: number }[];
}

/** Display unit and kind, and whether values are shares to show as %. */
export function unitOf(card: StatCard, P: Prepared, ctx: Ctx): { unit: string; kind: ValueKind; share: boolean } {
	const share = SHARE_MEASURES.includes(card.perLog) && !ADDS_UP.includes(card.overTime);
	if (card.overTime === 'count') return { unit: 'logs', kind: 'count', share: false };
	if (card.overTime === 'days') return { unit: 'days', kind: 'count', share: false };
	if (share) return { unit: '%', kind: 'percent', share };
	const src = card.what.source;
	if (src === 'outcomes') return { unit: card.perLog === 'done' ? 'times' : '', kind: 'count', share: false };
	if (src === 'slips') return { unit: 'slips', kind: 'count', share: false };
	if (src === 'cravings') return { unit: 'resisted', kind: 'count', share: false };
	if (src === 'money') {
		const h = P.ds.habits.find((x) => x.cost?.perDay);
		return { unit: h?.cost?.unit ?? '', kind: 'number', share: false };
	}
	if (src === 'field') {
		if (['sets', 'option', 'present', 'ticked'].includes(card.perLog))
			return { unit: card.perLog === 'sets' ? 'sets' : card.perLog === 'ticked' ? 'ticked' : 'times', kind: 'count', share: false };
		const f = fieldsFor(card, P, ctx);
		const m = f.metrics[0];
		const isTime = m?.type === 'duration' || UNITS[unitKey(f.unit)]?.dim === 't';
		return { unit: isTime ? 'min' : (f.unit ?? ''), kind: isTime ? 'duration' : m?.type === 'count' ? 'count' : 'number', share: false };
	}
	// task
	switch (card.perLog) {
		case 'volume':
		case 'e1rm':
			return { unit: P.ds.weightUnit, kind: 'number', share: false };
		case 'hardSets':
		case 'sets':
			return { unit: 'sets', kind: 'count', share: false };
		case 'pace': {
			const t = card.what.taskId ? P.roles.get(card.what.taskId)?.distance : null;
			return { unit: `min/${t?.unit || 'km'}`, kind: 'number', share: false };
		}
		case 'pctTarget':
			return { unit: '%', kind: 'percent', share: false };
		case 'targetMet':
			return { unit: 'times', kind: 'count', share: false };
		default: {
			const m = isCustom(card.perLog) ? ctx.settings.measures.find((x) => x.id === customId(card.perLog)) : null;
			return { unit: m?.unit ?? '', kind: 'number', share: false };
		}
	}
}

const round = (v: number | null, d = 2) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

function seriesList(points: Point[]): { key: string; label: string; order: number }[] {
	const m = new Map<string, { key: string; label: string; order: number }>();
	for (const p of points) for (const s of p.series) if (!m.has(s.key)) m.set(s.key, { key: s.key, label: s.label, order: s.order });
	return [...m.values()];
}

function bucketPoints(points: Point[], buckets: BucketInfo[]): Point[][] {
	const out: Point[][] = buckets.map(() => []);
	let i = 0;
	const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
	for (const p of sorted) {
		while (i < buckets.length && p.date > buckets[i].to) i++;
		if (i >= buckets.length) break;
		if (p.date >= buckets[i].from) out[i].push(p);
	}
	return out;
}

function sessionBuckets(points: Point[]): { buckets: BucketInfo[]; groups: Point[][] } {
	const g = new Map<string, Point[]>();
	for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
		const k = p.occId ?? p.date;
		const list = g.get(k);
		if (list) list.push(p);
		else g.set(k, [p]);
	}
	const keys = [...g.keys()];
	return {
		buckets: keys.map((k) => {
			const d = g.get(k)![0].date;
			return { key: k, label: shortDate(d), from: d, to: d };
		}),
		groups: keys.map((k) => g.get(k)!)
	};
}

/** Work out a card. */
export function computeCard(card: StatCard, P: Prepared, ctx: Ctx): CardResult {
	const rangeKey = card.range === 'page' ? ctx.boardRange : card.range;
	const range = resolveRange(rangeKey, ctx.today, P.earliest);
	const notes: string[] = [];
	const { unit, kind, share } = unitOf(card, P, ctx);
	const scale = (v: number | null) => (v === null ? null : share ? v * 100 : v);
	if (card.what.source === 'field') notes.push(...fieldsFor(card, P, ctx).left);

	const points = pointsFor(card, P, ctx, range);
	const chart = card.look.chart;
	const base: CardResult = {
		chart,
		range,
		unit,
		kind,
		empty: points.length === 0,
		notes,
		total: null,
		previousTotal: null,
		buckets: [],
		series: [],
		previous: null,
		rolling: null,
		goal: goalOf(card, P)
	};
	const how = card.overTime;
	base.total = round(scale(combine(allOf(points), how)));

	if (card.compare.previous) {
		const pr = previousRange(rangeKey, range);
		base.previousTotal = round(scale(combine(allOf(pointsFor(card, P, ctx, pr)), how)));
	}

	const bucketKind = card.bucket === 'auto' ? autoBucket(range) : card.bucket;

	const lineLike = () => {
		let buckets: BucketInfo[];
		let groups: Point[][];
		if (bucketKind === 'session') ({ buckets, groups } = sessionBuckets(points));
		else {
			buckets = bucketList(range, bucketKind);
			groups = bucketPoints(points, buckets);
		}
		let keys = seriesList(points).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
		const totalOf = (k: string) => combine(points.map((p) => wvOf(p, k)).filter((x): x is WV => !!x), how) ?? 0;
		let other: string[] = [];
		if (keys.length > card.look.top) {
			const ranked = [...keys].sort((a, b) => Math.abs(totalOf(b.key)) - Math.abs(totalOf(a.key)));
			const keep = new Set(ranked.slice(0, card.look.top).map((k) => k.key));
			other = keys.filter((k) => !keep.has(k.key)).map((k) => k.key);
			keys = keys.filter((k) => keep.has(k.key));
			notes.push(
				ADDS_UP.includes(how)
					? `Showing the top ${card.look.top} series; the rest are grouped as Other`
					: `Showing the top ${card.look.top} series; ${other.length} more are left out`
			);
		}
		const series: SeriesOut[] = keys.map((k) => ({
			key: k.key,
			label: k.label,
			values: groups.map((g) => round(scale(combine(g.map((p) => wvOf(p, k.key)).filter((x): x is WV => !!x), how)))),
			total: round(scale(totalOf(k.key)))
		}));
		if (other.length && ADDS_UP.includes(how)) {
			const inOther = (p: Point) => p.series.filter((s) => other.includes(s.key));
			series.push({
				key: 'other',
				label: 'Other',
				values: groups.map((g) =>
					round(combine(g.flatMap((p) => inOther(p).map((s) => ({ v: p.value, w: s.w, date: p.date }))), how))
				),
				total: round(combine(points.flatMap((p) => inOther(p).map((s) => ({ v: p.value, w: s.w, date: p.date }))), how))
			});
		}
		if (card.compare.running && ADDS_UP.includes(how)) {
			for (const s of series) {
				let run = 0;
				s.values = s.values.map((v) => round((run += v ?? 0)));
			}
		}
		base.buckets = buckets;
		base.series = series;
		if (card.compare.rolling && bucketKind !== 'all') base.rolling = rollingAvg(card, P, ctx, range, buckets, scale);
		if (card.compare.previous && bucketKind !== 'session') {
			const pr = previousRange(rangeKey, range);
			const pb = bucketList(pr, bucketKind);
			const pg = bucketPoints(pointsFor(card, P, ctx, pr), pb);
			base.previous = buckets.map((_, i) => (pg[i] ? round(scale(combine(allOf(pg[i]), how))) : null));
		}
	};

	switch (chart) {
		case 'tile': {
			// A small trend under the number.
			const bk = bucketKind === 'session' || bucketKind === 'all' ? autoBucket(range) : bucketKind;
			const buckets = bucketList(range, bk);
			const groups = bucketPoints(points, buckets);
			base.buckets = buckets;
			base.series = [{ key: 'all', label: '', values: groups.map((g) => round(scale(combine(allOf(g), how)))), total: base.total }];
			if (card.compare.running && ADDS_UP.includes(how)) {
				let run = 0;
				base.series[0].values = base.series[0].values.map((v) => round((run += v ?? 0)));
			}
			break;
		}
		case 'bars':
		case 'line':
			lineLike();
			break;
		case 'calendar': {
			const from = daysBetween(range.from, range.to) > 370 ? addDays(range.to, -370) : range.from;
			const r2 = { from, to: range.to };
			const days = bucketList(r2, 'day');
			const groups = bucketPoints(points, days);
			const single = card.what.source === 'outcomes' ? singleHabit(card, P, ctx) : null;
			const statusBy = single ? new Map((P.occsByHabit.get(single.id) ?? []).map((o) => [o.date, o.status])) : null;
			base.days = days.map((d, i) => ({
				date: d.from,
				value: round(scale(combine(allOf(groups[i]), how))),
				status: statusBy ? (statusBy.get(d.from) ?? (d.from > ctx.today ? 'future' : 'rest')) : null
			}));
			base.range = r2;
			break;
		}
		case 'goal': {
			const bk = bucketKind === 'session' || bucketKind === 'all' ? 'week' : bucketKind;
			const cur = bucketOf(range.to, bk);
			const inCur = points.filter((p) => p.date >= cur.from && p.date <= range.to);
			const keys = seriesList(inCur.length ? inCur : points);
			const g = base.goal;
			const period = bk === 'day' ? 'today' : bk === 'week' ? 'this week' : bk === 'month' ? 'this month' : bk === 'quarter' ? 'this quarter' : 'this year';
			base.goalRows = (keys.length ? keys : [{ key: 'all', label: '', order: 0 }])
				.sort((a, b) => a.order - b.order)
				.slice(0, card.look.top)
				.map((k) => ({
					key: k.key,
					label: k.label,
					value: round(scale(combine(inCur.map((p) => (k.key === 'all' ? { v: p.value, w: 1, date: p.date } : wvOf(p, k.key))).filter((x): x is WV => !!x), how))),
					goal: g?.min ?? null,
					goalMax: g?.max ?? null,
					period
				}));
			break;
		}
		case 'records':
			base.records = recordsFor(card, P, ctx, range, points, unit, kind);
			base.empty = !base.records.length;
			break;
		case 'table': {
			const keys = seriesList(points).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
			base.rows = keys.map((k) => {
				const mine = points.filter((p) => p.series.some((s) => s.key === k.key));
				const last = mine.reduce<Point | null>((a, p) => (!a || p.date >= a.date ? p : a), null);
				return {
					key: k.key,
					label: k.label || 'All',
					total: round(scale(combine(mine.map((p) => wvOf(p, k.key)!), how))),
					best: mine.length ? round(scale(Math.max(...mine.map((p) => p.value)))) : null,
					last: last ? round(scale(last.value)) : null,
					lastDate: last?.date ?? null,
					logs: new Set(mine.map((p) => p.occId ?? p.date)).size
				};
			});
			break;
		}
		case 'breakdown': {
			const keys = seriesList(points);
			const vals = keys
				.map((k) => ({ key: k.key, label: k.label, value: combine(points.map((p) => wvOf(p, k.key)).filter((x): x is WV => !!x), how) ?? 0 }))
				.sort((a, b) => b.value - a.value);
			let list = vals;
			if (vals.length > card.look.top) {
				const rest = vals.slice(card.look.top);
				list = [...vals.slice(0, card.look.top), { key: 'other', label: 'Other', value: rest.reduce((a, x) => a + x.value, 0) }];
			}
			const sum = list.reduce((a, x) => a + Math.max(x.value, 0), 0);
			base.breakdown = list.map((x) => ({ ...x, value: round(scale(x.value))!, share: sum ? Math.max(x.value, 0) / sum : 0 }));
			break;
		}
		case 'pattern': {
			const parts = partsOf(P.ds);
			const cells: WV[][][] = WEEKDAYS.map(() => parts.map(() => []));
			let untimed = 0;
			for (const p of points) {
				if (!p.time) {
					untimed++;
					continue;
				}
				const c = partIndex(parts, p.time);
				if (c >= 0) cells[weekday(p.date)][c].push({ v: p.value, w: 1, date: p.date });
			}
			if (untimed) notes.push(`${untimed} ${untimed === 1 ? 'log has' : 'logs have'} no time and ${untimed === 1 ? 'is' : 'are'} left out`);
			base.grid = { rows: WEEKDAYS, cols: parts.map((p) => p.name), values: cells.map((r) => r.map((c) => round(scale(combine(c, how))))) };
			base.empty = points.length === untimed;
			break;
		}
		case 'sessions':
			base.sessions = sessionsFor(card, P, ctx, range);
			base.empty = !base.sessions.length;
			break;
		case 'streak':
			base.streaks = streaksFor(card, P, ctx);
			base.empty = !base.streaks.length;
			break;
	}
	return base;
}

function singleHabit(card: StatCard, P: Prepared, ctx: Ctx): DsHabit | null {
	const sc = scope(card, P, ctx);
	const hs = P.ds.habits.filter((h) => h.direction === 'build' && !h.archived && sc.habitOnlyOk(h));
	return hs.length === 1 ? hs[0] : null;
}

function goalOf(card: StatCard, P: Prepared): { min: number; max: number | null } | null {
	if (card.compare.goal !== null) return { min: card.compare.goal, max: card.compare.goalMax };
	if (!card.compare.goalFromTargets) return null;
	const mids = card.what.source === 'field' ? card.what.metrics : [];
	let best: number | null = null;
	for (const s of P.ds.slots)
		for (const mid of mids) {
			const v = s.targets?.[mid];
			if (typeof v === 'number' && (best === null || v > best)) best = v;
		}
	return best === null ? null : { min: best, max: null };
}

function rollingAvg(card: StatCard, P: Prepared, ctx: Ctx, range: Range, buckets: BucketInfo[], scale: (v: number | null) => number | null): (number | null)[] {
	const w = card.compare.rolling;
	const ext = { from: addDays(range.from, -(w - 1)), to: range.to };
	const pts = pointsFor(card, P, ctx, ext);
	const days = bucketList(ext, 'day');
	const daily = bucketPoints(pts, days).map((g) => combine(allOf(g), card.overTime === 'sum' ? 'sum' : 'avg'));
	const at = (d: ISODate) => {
		const end = daysBetween(ext.from, d);
		const vals = daily.slice(Math.max(0, end - w + 1), end + 1).filter((v): v is number => v !== null);
		return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
	};
	return buckets.map((b) => round(scale(at(b.to > ctx.today ? ctx.today : b.to))));
}

function recordsFor(card: StatCard, P: Prepared, ctx: Ctx, range: Range, points: Point[], unit: string, kind: ValueKind): NonNullable<CardResult['records']> {
	const out: NonNullable<CardResult['records']> = [];
	const best = (ps: Point[]) => ps.reduce<Point | null>((a, p) => (!a || p.value > a.value ? p : a), null);
	const byPeriod = (ps: Point[], b: 'day' | 'week') => {
		const m = new Map<string, { v: number; date: ISODate }>();
		for (const p of ps) {
			const k = bucketOf(p.date, b);
			const cur = m.get(k.key) ?? { v: 0, date: k.from };
			cur.v += p.value;
			m.set(k.key, cur);
		}
		return [...m.values()].reduce<{ v: number; date: ISODate } | null>((a, x) => (!a || x.v > a.v ? x : a), null);
	};
	const taskId = card.what.source === 'task' ? card.what.taskId : card.what.source === 'field' && card.what.metrics.length ? P.metrics.get(card.what.metrics[0])?.taskId ?? null : null;
	const roles = taskId ? P.roles.get(taskId) : null;
	if (taskId && roles?.weight && roles.reps) {
		const t = { ...card, what: { ...card.what, source: 'task' as const, taskId } };
		const logs = (P.logsByTask.get(taskId) ?? []).filter((l) => l.occ.date >= range.from && l.occ.date <= range.to && scope(t, P, ctx).logOk(l));
		let heavy: { v: number; reps: number; date: ISODate; occId: string } | null = null;
		for (const l of logs)
			for (const s of l.sets) {
				const w = num(s[roles.weight.id]);
				const r = num(s[roles.reps.id]);
				if (w === null || !r) continue;
				const wv = convert(w, roles.weight.unit, P.ds.weightUnit);
				if (!heavy || wv > heavy.v || (wv === heavy.v && r > heavy.reps)) heavy = { v: wv, reps: r, date: l.occ.date, occId: l.occ.id };
			}
		if (heavy) out.push({ label: `Heaviest set (× ${heavy.reps})`, value: round(heavy.v)!, unit: P.ds.weightUnit, kind: 'number', date: heavy.date, occId: heavy.occId });
		for (const [pl, label, u, k] of [
			['e1rm', 'Best estimated 1RM', P.ds.weightUnit, 'number'],
			['volume', 'Most volume in a session', P.ds.weightUnit, 'number'],
			['sets', 'Most sets in a session', 'sets', 'count']
		] as const) {
			let top: { v: number; date: ISODate; occId: string } | null = null;
			for (const l of logs) {
				const v = taskValue(pl, l, P, ctx);
				if (v !== null && (!top || v > top.v)) top = { v, date: l.occ.date, occId: l.occ.id };
			}
			if (top) out.push({ label, value: round(top.v)!, unit: u, kind: k, date: top.date, occId: top.occId });
		}
		return out;
	}
	if (card.what.source === 'outcomes') {
		const h = singleHabit(card, P, ctx);
		if (h) {
			const s = streaksFor({ ...card, filter: { ...card.filter, habits: [h.id] } }, P, ctx)[0];
			if (s?.best !== null && s?.best !== undefined) out.push({ label: 'Longest streak', value: s.best, unit: s.unit === 'percent' ? '%' : 'in a row', kind: 'count', date: null, occId: null });
		}
		const done = points.filter((p) => p.value > 0);
		const wk = byPeriod(done, 'week');
		if (wk) out.push({ label: 'Most in one week', value: round(wk.v)!, unit, kind, date: wk.date, occId: null });
		out.push({ label: 'Total in range', value: done.length, unit: 'times', kind: 'count', date: null, occId: null });
		return out;
	}
	const b = best(points);
	if (b) out.push({ label: 'Best log', value: round(b.value)!, unit, kind, date: b.date, occId: b.occId });
	if (ADDS_UP.includes(card.overTime) || card.overTime === 'sum') {
		const d = byPeriod(points, 'day');
		if (d) out.push({ label: 'Best day', value: round(d.v)!, unit, kind, date: d.date, occId: null });
		const w = byPeriod(points, 'week');
		if (w) out.push({ label: 'Best week', value: round(w.v)!, unit, kind, date: w.date, occId: null });
	}
	return out;
}

/** "80 kg × 6, 6, 6, 5" for sets with the same weight, otherwise each set in full. */
export function describeLog(l: Log, P: Prepared): string {
	const ms = P.metricsByTask.get(l.task.id) ?? [];
	const rep = ms.filter((m) => m.repeats);
	const single = ms.filter((m) => !m.repeats);
	const fmt = (m: DsMetric, v: unknown) => {
		if (v === true) return m.name;
		if (!filled(v)) return null;
		return `${v}${m.unit ? ` ${m.unit}` : ''}`;
	};
	const parts: string[] = [];
	const r = P.roles.get(l.task.id);
	if (r?.weight && r.reps && rep.length === 2) {
		const groups: { w: string; reps: string[] }[] = [];
		for (const s of l.sets) {
			const w = fmt(r.weight, s[r.weight.id]) ?? '–';
			const n = filled(s[r.reps.id]) ? String(s[r.reps.id]) : '–';
			const last = groups.at(-1);
			if (last && last.w === w) last.reps.push(n);
			else groups.push({ w, reps: [n] });
		}
		if (groups.length) parts.push(groups.map((g) => `${g.w} × ${g.reps.join(', ')}`).join(' · '));
	} else if (rep.length) {
		const sets = l.sets.map((s) => rep.map((m) => fmt(m, s[m.id])).filter(Boolean).join(' × ')).filter(Boolean);
		if (sets.length) parts.push(sets.join(', '));
	}
	const singles = single.map((m) => fmt(m, l.single[m.id])).filter(Boolean);
	if (singles.length) parts.push(singles.join(' · '));
	if (l.subsTotal) parts.push(`${l.subsDone} of ${l.subsTotal} ${l.subsTotal === 1 ? 'step' : 'steps'}`);
	return parts.join(' · ') || 'Done';
}

function sessionsFor(card: StatCard, P: Prepared, ctx: Ctx, range: Range): NonNullable<CardResult['sessions']> {
	const sc = scope(card, P, ctx);
	const taskIds = card.what.taskId
		? [card.what.taskId]
		: card.what.source === 'field'
			? [...new Set(fieldsFor(card, P, ctx).metrics.map((m) => m.taskId))]
			: [];
	const logs = (taskIds.length ? taskIds.flatMap((t) => P.logsByTask.get(t) ?? []) : P.logs.filter((l) => card.what.source === 'outcomes'))
		.filter((l) => l.occ.date >= range.from && l.occ.date <= range.to && sc.logOk(l))
		.sort((a, b) => b.occ.date.localeCompare(a.occ.date) || (b.occ.time ?? '').localeCompare(a.occ.time ?? ''));
	return logs.slice(0, card.look.top).map((l) => ({
		date: l.occ.date,
		occId: l.occ.id,
		habit: l.habit.name,
		task: l.task.name,
		text: describeLog(l, P),
		met: targetMetOfLog(l, P)
	}));
}

function streaksFor(card: StatCard, P: Prepared, ctx: Ctx): NonNullable<CardResult['streaks']> {
	const sc = scope(card, P, ctx);
	// Slips cards show breaking habits only; habit outcome cards show both kinds.
	const hs = P.ds.habits
		.filter((h) => !h.archived && sc.habitOnlyOk(h) && (card.what.source !== 'slips' || h.direction === 'break'))
		.slice(0, card.look.top);
	const from = addDays(ctx.today, -27);
	return hs.map((h) => {
		if (h.direction === 'break' && h.limit) {
			// Reduce mode: periods in a row within the limit, the same count as Today.
			const l = h.limit;
			const slips = P.ds.slips.filter((s) => s.habitId === h.id);
			const current = withinStreak(l, slips, h.startDate, ctx.today);
			const step = l.period === 'week' ? 7 : 1;
			let best = 0;
			let run = 0;
			for (let d = l.period === 'week' ? weekStart(h.startDate) : h.startDate; d <= ctx.today; d = addDays(d, step)) {
				run = usedIn(l, slips, d) > limitOn(l, d) ? 0 : run + 1;
				best = Math.max(best, run);
			}
			const slipDays = new Set(slips.map((s) => s.date));
			const strip = [];
			for (let d = from; d <= ctx.today; d = addDays(d, 1))
				strip.push({ date: d, status: d < h.startDate ? 'rest' : !slipDays.has(d) ? 'clean' : withinOn(l, slips, d) ? 'within' : 'slip' });
			return { habitId: h.id, name: h.name, current, unit: l.period === 'week' ? ('withinWeeks' as const) : ('withinDays' as const), best, atRisk: false, strip };
		}
		if (h.direction === 'break') {
			// The same counts as Today and the habit page.
			const slipDates = P.ds.slips.filter((s) => s.habitId === h.id).map((s) => s.date);
			const slipDays = new Set(slipDates);
			const current = Math.max(daysSinceSlip(slipDates, h.startDate, ctx.today), 0);
			const best = Math.max(longestRun(slipDates, h.startDate, ctx.today), current);
			const strip = [];
			for (let d = from; d <= ctx.today; d = addDays(d, 1))
				strip.push({ date: d, status: d < h.startDate ? 'rest' : slipDays.has(d) ? 'slip' : 'clean' });
			return { habitId: h.id, name: h.name, current, unit: 'days' as const, best, atRisk: false, strip };
		}
		const marks: Mark[] = (P.occsByHabit.get(h.id) ?? []).filter((o) => o.date <= ctx.today).map((o) => ({ date: o.date, status: o.status, level: o.level }));
		const r = streak(marks, h.streakRule, { minimumCounts: h.minimumCounts, today: ctx.today });
		let best: number | null = null;
		if (r.unit === 'streak') {
			const recent = marks.slice(-400);
			best = 0;
			for (let i = 0; i < recent.length; i++) {
				if (recent[i].status === 'due') continue;
				best = Math.max(best, streak(recent.slice(0, i + 1), h.streakRule, { minimumCounts: h.minimumCounts }).value);
			}
			best = Math.max(best, r.value);
		}
		const cells = chainCells(marks, h.streakRule, from, ctx.today, ctx.today);
		return {
			habitId: h.id,
			name: h.name,
			current: r.value,
			unit: r.unit,
			best,
			atRisk: r.atRisk,
			strip: cells.map((c) => ({ date: c.date, status: c.cell.kind === 'missed' && c.cell.forgiven ? 'forgiven' : c.cell.kind }))
		};
	});
}

// ---------- drill down ----------

export interface DrillRow {
	date: ISODate;
	value: number;
	occId: string | null;
	habit: string;
	task: string | null;
	text: string | null;
}

/** The logs behind a number: a whole card, one bucket, or one series in one bucket. */
export function drill(card: StatCard, P: Prepared, ctx: Ctx, range: Range, seriesKey: string | null): DrillRow[] {
	const share = SHARE_MEASURES.includes(card.perLog);
	const ps = pointsFor(card, P, ctx, range).filter((p) => !seriesKey || seriesKey === 'all' || p.series.some((s) => s.key === seriesKey));
	const logBy = new Map(P.logs.map((l) => [`${l.occ.id}|${l.task.id}`, l]));
	return ps
		.sort((a, b) => b.date.localeCompare(a.date))
		.slice(0, 200)
		.map((p) => {
			const l = p.occId && p.taskId ? logBy.get(`${p.occId}|${p.taskId}`) : undefined;
			return {
				date: p.date,
				value: round(share ? p.value * 100 : p.value)!,
				occId: p.occId,
				habit: P.habits.get(p.habitId)?.name ?? '',
				task: p.taskId ? (P.tasks.get(p.taskId)?.name ?? null) : null,
				text: l ? describeLog(l, P) : null
			};
		});
}

/** Rows for a CSV of a card: one row per bucket and series. */
export function cardCsv(card: StatCard, r: CardResult): string[][] {
	const head = ['From', 'To', 'Series', `Value${r.unit ? ` (${r.unit})` : ''}`];
	if (r.series.length && r.buckets.length) {
		const rows = r.buckets.flatMap((b, i) => r.series.map((s) => [b.from, b.to, s.label || card.title || 'All', s.values[i] === null ? '' : String(s.values[i])]));
		return [head, ...rows];
	}
	if (r.days) return [['Date', `Value${r.unit ? ` (${r.unit})` : ''}`, 'Status'], ...r.days.map((d) => [d.date, d.value === null ? '' : String(d.value), d.status ?? ''])];
	if (r.rows) return [['Series', 'Total', 'Best', 'Last', 'Last date', 'Logs'], ...r.rows.map((x) => [x.label, String(x.total ?? ''), String(x.best ?? ''), String(x.last ?? ''), x.lastDate ?? '', String(x.logs)])];
	if (r.breakdown) return [['Series', 'Value', 'Share'], ...r.breakdown.map((x) => [x.label, String(x.value), (x.share * 100).toFixed(1) + '%'])];
	if (r.records) return [['Record', 'Value', 'Unit', 'Date'], ...r.records.map((x) => [x.label, String(x.value), x.unit, x.date ?? ''])];
	if (r.sessions) return [['Date', 'Habit', 'Task', 'What was done', 'Target met'], ...r.sessions.map((s) => [s.date, s.habit, s.task, s.text, s.met === null ? '' : s.met === 1 ? 'yes' : s.met === 0 ? 'no' : 'partly'])];
	if (r.grid) return [['Weekday', ...r.grid.cols], ...r.grid.rows.map((row, i) => [row, ...r.grid!.values[i].map((v) => (v === null ? '' : String(v)))])];
	if (r.goalRows) return [['Series', 'Value', 'Goal', 'Period'], ...r.goalRows.map((g) => [g.label || 'All', String(g.value ?? ''), String(g.goal ?? ''), g.period])];
	if (r.streaks) return [['Habit', 'Current', 'Best'], ...r.streaks.map((s) => [s.name, String(s.current), String(s.best ?? '')])];
	return [head, [r.range.from, r.range.to, card.title || 'All', r.total === null ? '' : String(r.total)]];
}

/** A cell a spreadsheet would run as a formula (=, +, -, @) gets a leading ' unless it is a plain number. */
const safeCell = (c: string) => (/^[=+\-@\t\r]/.test(c) && !/^[-+]?\d+(\.\d+)?$/.test(c) ? `'${c}` : c);

export const toCsv = (rows: string[][]) =>
	rows
		.map((r) =>
			r
				.map(safeCell)
				.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
				.join(',')
		)
		.join('\n') + '\n';

/** Today for the board: the same helpers, re-exported for the page. */
export { toDays, fromDays };
