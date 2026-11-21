// Views: what each page shows and in what order, saved per user.
// A view template (Routine, Minimal, Gym-focused...) is only a starting bundle of these settings;
// after picking one, every setting can still be changed on its own.
import { z } from 'zod';

export const PAGES = ['today', 'habits', 'library', 'history'] as const;
export type Page = (typeof PAGES)[number];
export const PAGE_PATH: Record<Page, string> = { today: '/', habits: '/habits', library: '/library', history: '/history' };
export const PAGE_LABEL: Record<Page, string> = { today: 'Today', habits: 'Habits', library: 'Library', history: 'History' };

/** Sort orders each page offers, first one is the fallback. */
export const SORTS = {
	today: { cue: 'Time of day', manual: 'My order', name: 'Name', streak: 'Streak at risk first' },
	habits: { manual: 'My order', name: 'Name', consistency: 'Consistency', created: 'Newest first' },
	library: { name: 'Name', recent: 'Newest first', used: 'Most logged', logged: 'Last logged' },
	history: { newest: 'Newest first', oldest: 'Oldest first' }
} as const satisfies Record<Page, Record<string, string>>;

/** Grouping each page offers. */
export const GROUPS = {
	today: { none: 'No groups', area: 'Area', part: 'Part of day', identity: 'Identity' },
	habits: { none: 'No groups', area: 'Area', direction: 'Build / break', identity: 'Identity' },
	library: { none: 'No groups', area: 'Area' },
	history: { none: 'By day' }
} as const satisfies Record<Page, Record<string, string>>;

export const STATUSES = { all: 'Any status', done: 'Done', skipped: 'Skipped', missed: 'Missed', slip: 'Slips' } as const;
export const TODAY_STATUSES = { all: 'Any status', due: 'Still due', done: 'Done or skipped' } as const;

const str = (n = 200) => z.string().max(n);

/** One page's filter, sort and grouping. Fields a page doesn't use are ignored there. */
export const viewState = z.object({
	areas: z.array(str(64)).max(50).default([]),
	direction: z.enum(['all', 'build', 'break']).default('all'),
	status: z.enum(['all', 'due', 'done', 'skipped', 'missed', 'slip']).default('all'),
	identity: str(64).nullable().default(null),
	habit: str(64).nullable().default(null),
	query: str(200).default(''),
	tags: z.array(str(100)).max(50).default([]),
	collection: str(64).nullable().default(null),
	archived: z.boolean().default(false),
	sort: str(32).default(''),
	group: str(32).default('none')
});
export type ViewState = z.infer<typeof viewState>;
export const emptyState = (): ViewState => viewState.parse({});

export const savedView = z.object({
	id: str(64),
	name: str(40).min(1),
	page: z.enum(PAGES),
	state: viewState
});
export type SavedView = z.infer<typeof savedView>;

export const SECTIONS = {
	due: 'Due today',
	breaking: 'Breaking and limiting',
	prep: 'Prepare for tomorrow',
	paused: 'Paused',
	resting: 'Not due today'
} as const;
export type SectionKey = keyof typeof SECTIONS;
const sectionKeys = Object.keys(SECTIONS) as [SectionKey, ...SectionKey[]];

export const DONE_MODES = {
	keep: 'Stay where they are',
	bottom: 'Move to the bottom',
	collapse: 'Fold into a "Done" line',
	hide: 'Hide them'
} as const;

export const WIDGETS = {
	progress: 'Progress today (3 of 5 done)',
	week: 'This week, day by day',
	atRisk: 'Streaks at risk',
	quit: 'Quit counters and money saved'
} as const;
export type WidgetKey = keyof typeof WIDGETS;

/** Lines a Today card can show under the habit's name. */
export const LINES = {
	cue: 'When and where',
	headline: 'Headline number (streak, consistency...)',
	levels: 'Minimum / Stretch buttons',
	reframe: 'Reframe line',
	bundle: 'Paired reward',
	reward: 'Reward jar',
	progression: 'Raise targets suggestion',
	identities: 'Identity votes'
} as const;
export type LineKey = keyof typeof LINES;

/** The one number a habit shows on Today. */
export const STATS = {
	streak: 'Streak',
	consistency: 'Consistency, last 30 days',
	week: 'Done this week',
	total: 'Times done',
	none: 'Nothing'
} as const;
export type StatKey = keyof typeof STATS;

export const HABIT_LINES = {
	schedule: 'Schedule',
	cue: 'When',
	area: 'Area',
	consistency: 'Consistency, last 30 days',
	last: 'Last done'
} as const;
export type HabitLineKey = keyof typeof HABIT_LINES;

/** Whole features that can be switched off app-wide. Data is kept; only buttons and sections go away. */
export const FEATURES = {
	identities: 'Identities',
	levels: 'Levels (Minimum / Target / Stretch)',
	rewards: 'Rewards and paired treats',
	cost: 'Cost and money saved',
	prep: 'Prepare the day before',
	ifThen: 'If-then plans',
	reframe: 'Reframe lines',
	progression: 'Raise targets suggestions'
} as const;
export type FeatureKey = keyof typeof FEATURES;

const keysOf = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const viewSettings = z.object({
	template: str(32).default('standard'),
	/** What a page opens with: the last filter you used, the page default, or a saved view (its id). */
	open: z.partialRecord(z.enum(PAGES), str(64)).default({}),
	/** The page default each page resets to. */
	defaults: z.partialRecord(z.enum(PAGES), viewState).default({}),
	/** The last state of each page, kept while `open` is "last". */
	last: z.partialRecord(z.enum(PAGES), viewState).default({}),
	saved: z.array(savedView).max(60).default([]),
	startPage: z.enum(PAGES).default('today'),
	today: z
		.object({
			sections: z.array(z.object({ key: z.enum(sectionKeys), show: z.boolean() })).default([]),
			done: z.enum(keysOf(DONE_MODES)).default('keep'),
			widgets: z.array(z.enum(keysOf(WIDGETS))).default([]),
			lines: z.array(z.enum(keysOf(LINES))).default(Object.keys(LINES) as LineKey[]),
			/** Show only what fits the current part of the day. */
			timeAware: z.boolean().default(false),
			headline: z.enum(keysOf(STATS)).default('streak'),
			headlineFor: z.record(str(64), z.enum(keysOf(STATS))).default({}),
			/** Habit ids in the user's own order, for the "My order" sort. */
			order: z.array(str(64)).max(500).default([])
		})
		.prefault({}),
	habits: z
		.object({ lines: z.array(z.enum(keysOf(HABIT_LINES))).default(['schedule', 'cue', 'area']) })
		.prefault({}),
	history: z.object({ values: z.boolean().default(false) }).prefault({}),
	hidden: z.array(z.enum(keysOf(FEATURES))).default([])
});
export type ViewSettings = z.infer<typeof viewSettings>;

/** Every section, in order, with the ones a list leaves out added at the end. */
export function sectionOrder(v: ViewSettings): { key: SectionKey; show: boolean }[] {
	const seen = new Set(v.today.sections.map((s) => s.key));
	return [...v.today.sections, ...sectionKeys.filter((k) => !seen.has(k)).map((key) => ({ key, show: true }))];
}

type TemplatePatch = {
	today?: Partial<ViewSettings['today']>;
	habits?: Partial<ViewSettings['habits']>;
	history?: Partial<ViewSettings['history']>;
	hidden?: FeatureKey[];
	defaults?: Partial<Record<Page, Partial<ViewState>>>;
};

export interface ViewTemplate {
	id: string;
	name: string;
	/** One line on who it's for. */
	blurb: string;
	/** What it changes, shown before switching. */
	summary: string;
	patch: TemplatePatch;
}

const allLines = Object.keys(LINES) as LineKey[];

export const TEMPLATES: ViewTemplate[] = [
	{
		id: 'routine',
		name: 'Morning and evening routine',
		blurb: 'Your day in order: what fits now first, grouped by part of the day.',
		summary: 'Today shows what fits the current part of the day, grouped by Morning, Afternoon and so on, in your own order.',
		patch: {
			today: { timeAware: true, done: 'bottom', widgets: ['progress'] },
			defaults: { today: { group: 'part', sort: 'manual' } }
		}
	},
	{
		id: 'standard',
		name: 'Standard',
		blurb: 'Everything on, in the classic layout.',
		summary: 'Every section and line shows, sorted by time of day.',
		patch: {}
	},
	{
		id: 'minimal',
		name: 'Minimal',
		blurb: 'A plain checklist. Nothing extra.',
		summary: 'Today shows only what is due, done items fold away, and extras like Identities, Levels and Rewards are hidden.',
		patch: {
			today: {
				sections: [
					{ key: 'due', show: true },
					{ key: 'breaking', show: true },
					{ key: 'prep', show: false },
					{ key: 'paused', show: false },
					{ key: 'resting', show: false }
				],
				done: 'collapse',
				lines: [],
				headline: 'none'
			},
			habits: { lines: ['schedule'] },
			hidden: ['identities', 'levels', 'rewards', 'cost', 'prep', 'ifThen', 'reframe', 'progression']
		}
	},
	{
		id: 'gym',
		name: 'Gym-focused',
		blurb: 'For training plans: the week at a glance and your progress.',
		summary: 'Adds a week strip and progress to Today, shows "done this week" on each habit, and sorts the Library by most logged.',
		patch: {
			today: {
				widgets: ['progress', 'week'],
				done: 'bottom',
				headline: 'week',
				lines: ['cue', 'headline', 'levels', 'progression'],
				sections: [
					{ key: 'due', show: true },
					{ key: 'resting', show: true },
					{ key: 'prep', show: true },
					{ key: 'breaking', show: true },
					{ key: 'paused', show: true }
				]
			},
			hidden: ['rewards', 'cost'],
			defaults: { library: { sort: 'used' } }
		}
	},
	{
		id: 'quitter',
		name: 'Quitter',
		blurb: 'For breaking habits: counters and money saved first.',
		summary: 'Puts Breaking first, adds quit counters and money saved, and hides Levels and prep.',
		patch: {
			today: {
				widgets: ['quit', 'atRisk'],
				sections: [
					{ key: 'breaking', show: true },
					{ key: 'due', show: true },
					{ key: 'prep', show: false },
					{ key: 'paused', show: true },
					{ key: 'resting', show: true }
				]
			},
			hidden: ['levels', 'prep', 'progression']
		}
	},
	{
		id: 'data',
		name: 'Data nerd',
		blurb: 'Every number, everywhere.',
		summary: 'Adds every widget, shows consistency on each habit, values in History, and every line on the Habits list.',
		patch: {
			today: { widgets: ['progress', 'week', 'atRisk', 'quit'], headline: 'consistency', lines: allLines },
			habits: { lines: ['schedule', 'cue', 'area', 'consistency', 'last'] },
			history: { values: true }
		}
	}
];

export const DEFAULT_TEMPLATE_NEW = 'routine';
export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

/** The settings a template gives, from scratch. Saved views and manual order are kept by the caller. */
export function fromTemplate(id: string, opts: { groupByArea?: boolean } = {}): ViewSettings {
	const t = templateById(id) ?? templateById('standard')!;
	const base = viewSettings.parse({});
	const defaults: ViewSettings['defaults'] = {};
	for (const p of PAGES) {
		defaults[p] = viewState.parse({
			sort: Object.keys(SORTS[p])[0],
			group: opts.groupByArea && 'area' in GROUPS[p] ? 'area' : 'none',
			...(t.patch.defaults?.[p] ?? {})
		});
	}
	return viewSettings.parse({
		...base,
		template: t.id,
		defaults,
		today: { ...base.today, ...(t.patch.today ?? {}) },
		habits: { ...base.habits, ...(t.patch.habits ?? {}) },
		history: { ...base.history, ...(t.patch.history ?? {}) },
		hidden: t.patch.hidden ?? []
	});
}

/** Switch template, keeping what belongs to the user: saved views, manual order, per-habit numbers, start page. */
export function switchTemplate(current: ViewSettings, id: string): ViewSettings {
	const next = fromTemplate(id);
	return {
		...next,
		saved: current.saved,
		startPage: current.startPage,
		today: { ...next.today, order: current.today.order, headlineFor: current.today.headlineFor }
	};
}

/** Read stored views, filling anything missing. Unknown or broken data falls back to the template. */
export function readViews(raw: unknown, opts: { groupByArea?: boolean } = {}): ViewSettings {
	if (!raw) return fromTemplate('standard', opts);
	const parsed = viewSettings.safeParse(raw);
	if (!parsed.success) return fromTemplate(typeof (raw as { template?: unknown }).template === 'string' ? (raw as { template: string }).template : 'standard', opts);
	const v = parsed.data;
	for (const p of PAGES) if (!v.defaults[p]) v.defaults[p] = fromTemplate(v.template, opts).defaults[p];
	// A deleted saved view can't be what a page opens with.
	for (const p of PAGES) {
		const o = v.open[p];
		if (o && o !== 'last' && o !== 'default' && !v.saved.some((s) => s.id === o)) delete v.open[p];
	}
	return v;
}

/** The state a page opens with. */
export function initialState(v: ViewSettings, page: Page): ViewState {
	const open = v.open[page] ?? 'last';
	const def = v.defaults[page] ?? emptyState();
	if (open === 'default') return def;
	if (open === 'last') return v.last[page] ?? def;
	return v.saved.find((s) => s.id === open)?.state ?? def;
}

export const isHidden = (v: Pick<ViewSettings, 'hidden'>, f: FeatureKey) => v.hidden.includes(f);

/** Two states show the same thing (used to light up the matching saved view chip). */
export function sameState(a: ViewState, b: ViewState): boolean {
	return JSON.stringify(viewState.parse(a)) === JSON.stringify(viewState.parse(b));
}

/** Which named part of the day a time falls in. Ranges may wrap past midnight. */
export function partAt(ranges: { name: string; start: string; end: string }[], time: string): string | null {
	for (const r of ranges) {
		if (r.start <= r.end ? time >= r.start && time < r.end : time >= r.start || time < r.end) return r.name;
	}
	return null;
}

// ----- Filtering and sorting shared by the pages -----

export interface Groupable {
	areaId: string | null;
	identities?: string[];
	direction?: string;
	part?: string | null;
}

export interface Group<T> {
	key: string;
	label: string;
	color: string | null;
	items: T[];
}

/** Split a list into groups in a stable, meaningful order. Empty groups are left out. */
export function groupBy<T extends Groupable>(
	items: T[],
	group: string,
	ctx: { areas: { id: string; name: string; icon: string; color: string }[]; parts?: string[] }
): Group<T>[] {
	if (group === 'area') {
		const known = (id: string | null) => !!id && ctx.areas.some((a) => a.id === id);
		return [
			...ctx.areas.map((a) => ({
				key: a.id,
				label: `${a.icon} ${a.name}`.trim(),
				color: a.color,
				items: items.filter((i) => i.areaId === a.id)
			})),
			{ key: 'none', label: 'No area', color: null, items: items.filter((i) => !known(i.areaId)) }
		].filter((g) => g.items.length);
	}
	if (group === 'identity') {
		const names = [...new Set(items.flatMap((i) => i.identities ?? []))].sort((a, b) => a.localeCompare(b));
		return [
			...names.map((n) => ({ key: `i:${n}`, label: n, color: null, items: items.filter((i) => i.identities?.includes(n)) })),
			{ key: 'none', label: 'No identity', color: null, items: items.filter((i) => !i.identities?.length) }
		].filter((g) => g.items.length);
	}
	if (group === 'part') {
		const parts = ctx.parts ?? [];
		return [
			...parts.map((p) => ({ key: `p:${p}`, label: p, color: null, items: items.filter((i) => i.part === p) })),
			{ key: 'none', label: 'Any time', color: null, items: items.filter((i) => !i.part || !parts.includes(i.part)) }
		].filter((g) => g.items.length);
	}
	if (group === 'direction') {
		return [
			{ key: 'build', label: 'Building', color: null, items: items.filter((i) => i.direction !== 'break') },
			{ key: 'break', label: 'Breaking', color: null, items: items.filter((i) => i.direction === 'break') }
		].filter((g) => g.items.length);
	}
	return [{ key: 'all', label: '', color: null, items }];
}

/** Put items in the user's own order; ones not in the list keep their current order after those that are. */
export function manualOrder<T>(items: T[], order: string[], id: (t: T) => string): T[] {
	const pos = new Map(order.map((x, i) => [x, i]));
	return items
		.map((t, i) => ({ t, i, p: pos.get(id(t)) }))
		.sort((a, b) => (a.p ?? 1e9) - (b.p ?? 1e9) || a.i - b.i)
		.map((x) => x.t);
}

/** Does an item pass the Area, direction and Identity filters? */
export function passes(s: ViewState, i: Groupable): boolean {
	if (s.areas.length && !s.areas.includes(i.areaId ?? '')) return false;
	if (s.direction === 'build' && i.direction === 'break') return false;
	if (s.direction === 'break' && i.direction !== 'break') return false;
	if (s.identity && !(i.identities ?? []).includes(s.identity)) return false;
	return true;
}

/** How many filters are on, to show on the Customize button. */
export function activeFilters(s: ViewState): number {
	return (
		(s.areas.length ? 1 : 0) +
		(s.direction !== 'all' ? 1 : 0) +
		(s.status !== 'all' ? 1 : 0) +
		(s.identity ? 1 : 0) +
		(s.habit ? 1 : 0) +
		(s.query ? 1 : 0) +
		(s.tags.length ? 1 : 0) +
		(s.collection ? 1 : 0)
	);
}
