// What the card builder needs to know about an account, without the logs themselves:
// habits, Tasks, fields and tags. Built on the server, sent to the page, and used for the
// builder's pickers and for the context the stats rules read.
import type { Prepared } from './engine';
import { ADDS_UP, PER_LOG_FOR, isCustom, customId, type CustomMeasure, type Source, type StatCard } from './model';
import { formulaProblem } from './formula';

export interface Catalog {
	habits: { id: string; name: string; direction: 'build' | 'break'; archived: boolean; areaId: string | null; hasCost: boolean; logged: number }[];
	tasks: { id: string; name: string; areaId: string | null; tags: string[]; strength: boolean; cardio: boolean; targets: boolean; logged: number }[];
	metrics: { id: string; taskId: string; name: string; type: string; unit: string | null; repeats: boolean; targets: boolean; scored?: boolean }[];
	tags: string[];
	areas: { id: string; name: string; icon: string; color: string }[];
	identities: { id: string; name: string }[];
}

export function catalogOf(P: Prepared, extra: { areas: Catalog['areas']; identities: Catalog['identities'] }): Catalog {
	const targeted = new Set(P.ds.slots.flatMap((s) => Object.keys(s.targets ?? {})));
	const taskTargets = new Set(P.ds.slots.filter((s) => s.taskId && s.targets && Object.keys(s.targets).length).map((s) => s.taskId!));
	return {
		habits: P.ds.habits.map((h) => ({
			id: h.id,
			name: h.name,
			direction: h.direction,
			archived: h.archived,
			areaId: h.areaId,
			hasCost: !!h.cost?.perDay,
			logged: (P.occsByHabit.get(h.id) ?? []).filter((o) => o.status === 'done').length
		})),
		tasks: P.ds.tasks
			.filter((t) => !t.parentTaskId)
			.map((t) => {
				const r = P.roles.get(t.id);
				return {
					id: t.id,
					name: t.name,
					areaId: t.areaId,
					tags: t.tags.map((x) => x.name),
					strength: !!r?.weight && !!r.reps,
					cardio: !!r?.distance && !!r.time,
					targets: taskTargets.has(t.id),
					logged: (P.logsByTask.get(t.id) ?? []).length
				};
			}),
		metrics: P.ds.metrics.map((m) => ({
			id: m.id,
			taskId: m.taskId,
			name: m.name,
			type: m.type,
			unit: m.unit,
			repeats: m.repeats,
			targets: targeted.has(m.id),
			scored: m.type === 'choice' && !!m.scores && Object.keys(m.scores).length > 0
		})),
		tags: [...new Set(P.ds.tasks.flatMap((t) => t.tags.map((x) => x.name)))].sort((a, b) => a.localeCompare(b)),
		areas: extra.areas,
		identities: extra.identities
	};
}

/** What the stats rules need to know about the habits, Tasks and fields a card reads. */
export interface StatCtx {
	/** Types of the fields a field card reads. */
	fieldTypes: string[];
	/** Every field read is logged per set. */
	repeats: boolean;
	/** Every field read is a Choice with a number per option (mood 5 to 1). */
	scored: boolean;
	/** The fields read have units that can't be added together. */
	mixedUnits: boolean;
	/** Some Task in scope has a weight and a reps field. */
	weightReps: boolean;
	/** Some Task in scope has a time and a distance field. */
	pace: boolean;
	/** The field (or Task) read has Slot targets. */
	targets: boolean;
	buildHabits: boolean;
	breakHabits: boolean;
	/** A habit with a daily cost is in scope. */
	cost: boolean;
	/** Whole features switched off app-wide (views). */
	hidden: string[];
	/** Every habit or Task the card names is archived. */
	archived: boolean;
	/** What is wrong with the custom measure it uses, if anything. */
	measureProblem: string | null;
}

export const emptyCtx = (): StatCtx => ({
	fieldTypes: [],
	repeats: false,
	scored: false,
	mixedUnits: false,
	weightReps: true,
	pace: true,
	targets: true,
	buildHabits: true,
	breakHabits: true,
	cost: true,
	hidden: [],
	archived: false,
	measureProblem: null
});

const unitDim = (u: string | null) => {
	const k = (u ?? '').trim().toLowerCase();
	if (['s', 'sec', 'secs', 'seconds', 'min', 'mins', 'minute', 'minutes', 'h', 'hr', 'hrs', 'hour', 'hours'].includes(k)) return 't';
	if (['g', 'kg', 'lb', 'lbs'].includes(k)) return 'w';
	if (['m', 'km', 'mi', 'mile', 'miles'].includes(k)) return 'd';
	return `u:${k}`;
};

/** The fields a field card reads, from the catalog. */
export function cardFields(card: StatCard, c: Catalog) {
	if (card.what.metrics.length) return c.metrics.filter((m) => card.what.metrics.includes(m.id));
	if (card.what.name) {
		const n = card.what.name.trim().toLowerCase();
		const tags = card.filter.tags.map((t) => t.toLowerCase());
		return c.metrics.filter((m) => {
			if (m.name.trim().toLowerCase() !== n) return false;
			const t = c.tasks.find((x) => x.id === m.taskId);
			return !!t && (!tags.length || t.tags.some((x) => tags.includes(x.toLowerCase())));
		});
	}
	return [];
}

export function statCtx(card: StatCard, c: Catalog, opts: { hidden?: string[]; measures?: CustomMeasure[] } = {}): StatCtx {
	const habits = c.habits.filter((h) => !card.filter.habits.length || card.filter.habits.includes(h.id));
	const fields = cardFields(card, c);
	const tasks = card.what.taskId
		? c.tasks.filter((t) => t.id === card.what.taskId)
		: card.what.source === 'field'
			? c.tasks.filter((t) => fields.some((m) => m.taskId === t.id))
			: c.tasks;
	const dims = new Set(fields.map((m) => unitDim(m.unit)));
	const types = [...new Set(fields.map((m) => m.type))];
	const m = isCustom(card.perLog) ? (opts.measures ?? []).find((x) => x.id === customId(card.perLog)) : null;
	const named = [...card.filter.habits.map((id) => c.habits.find((h) => h.id === id)), card.what.taskId ? c.tasks.find((t) => t.id === card.what.taskId) : undefined];
	return {
		fieldTypes: types,
		repeats: fields.length > 0 && fields.every((f) => f.repeats),
		scored: fields.length > 0 && fields.every((f) => f.scored),
		mixedUnits: dims.size > 1 || types.length > 1,
		weightReps: tasks.some((t) => t.strength),
		pace: tasks.some((t) => t.cardio),
		targets: card.what.source === 'field' ? fields.some((f) => f.targets) : tasks.some((t) => t.targets),
		buildHabits: habits.some((h) => h.direction === 'build'),
		breakHabits: habits.some((h) => h.direction === 'break'),
		cost: habits.some((h) => h.hasCost),
		hidden: opts.hidden ?? [],
		archived: named.some(Boolean) && named.filter(Boolean).every((x) => 'archived' in x! && (x as { archived: boolean }).archived),
		measureProblem: isCustom(card.perLog) ? (m ? formulaProblem(m.formula) : 'This measure was deleted') : null
	};
}

/** Per-log measures that make sense for a card's source and fields (for the builder's picker). */
export function perLogChoices(card: StatCard, c: Catalog, measures: CustomMeasure[]): string[] {
	const src: Source = card.what.source;
	if (src === 'field') {
		const fields = cardFields(card, c);
		const t = fields[0]?.type;
		if (t === 'checkbox') return ['ticked'];
		if (t === 'choice') return fields.every((f) => f.scored) ? ['option', 'score'] : ['option'];
		if (t === 'text') return ['present'];
		return fields.length && fields.every((f) => f.repeats) ? ['sum', 'best', 'avg', 'sets'] : ['value'];
	}
	if (src === 'task') return [...PER_LOG_FOR.task, ...measures.map((m) => `custom:${m.id}`)];
	return PER_LOG_FOR[src];
}

export { ADDS_UP };

const OVER_WORD: Record<string, string> = { sum: '', avg: 'average', median: 'median', min: 'lowest', max: 'best', last: 'latest', count: 'logs', days: 'days' };
const BUCKET_WORD: Record<string, string> = { day: 'per day', week: 'per week', month: 'per month', quarter: 'per quarter', year: 'per year', session: 'per session', all: '', auto: '' };

/** A title made from what the card reads, for cards nobody named. */
export function autoTitle(card: StatCard, c: Catalog, measures: CustomMeasure[]): string {
	const src = card.what.source;
	let subject: string;
	if (src === 'field') {
		const fs = cardFields(card, c);
		const task = (id: string) => c.tasks.find((t) => t.id === id)?.name;
		subject = card.what.name
			? card.what.name
			: fs.length === 1
				? `${task(fs[0].taskId) ?? ''}: ${fs[0].name.toLowerCase()}`
				: fs.map((f) => f.name).join(', ') || 'Fields';
	} else if (src === 'task') {
		const t = card.what.taskId ? c.tasks.find((x) => x.id === card.what.taskId)?.name : null;
		const m = isCustom(card.perLog) ? (measures.find((x) => x.id === customId(card.perLog))?.name ?? 'Measure') : ({ volume: 'Volume', e1rm: 'Estimated 1RM', hardSets: 'Hard sets', sets: 'Sets', pace: 'Pace', pctTarget: '% of target', targetMet: 'Target met' } as Record<string, string>)[card.perLog] ?? 'Tasks';
		subject = t ? `${t}: ${m.toLowerCase()}` : m;
	} else {
		subject = (
			{
				outcomes: card.perLog === 'rate' ? 'Consistency' : card.perLog === 'targetMet' ? 'Target met' : 'Done',
				slips: 'Slips',
				cravings: 'Cravings resisted',
				money: 'Money saved'
			} as Record<string, string>
		)[src];
	}
	const over = ADDS_UP.includes(card.overTime) || src === 'outcomes' ? '' : OVER_WORD[card.overTime];
	const parts = [over ? `${subject}, ${over}` : subject];
	const bucket = ['bars', 'line'].includes(card.look.chart) ? BUCKET_WORD[card.bucket] : '';
	if (bucket) parts.push(bucket);
	if (card.split !== 'none') parts.push(`by ${({ tag: 'muscle group', part: 'part of the day', set: 'set number', option: 'option' } as Record<string, string>)[card.split] ?? card.split}`);
	const t = parts.join(' ');
	return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}
