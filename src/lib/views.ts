// Views: what each page shows and in what order, saved per user.
// A view template (Routine, Minimal, Week first...) is only a starting bundle of these settings;
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

const keysOf = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const DONE_MODES = {
	keep: 'Stay where they are',
	bottom: 'Move to the bottom',
	collapse: 'Fold into a "Done" heading',
	hide: 'Hide them'
} as const;

/** Lines a Today card can show under the habit's name. */
export const LINES = {
	cue: 'When and where',
	headline: 'Headline number (streak, consistency...)',
	levels: 'Minimum / Stretch buttons',
	reframe: 'Reframe line',
	bundle: 'Paired reward',
	reward: 'Reward jar',
	progression: 'Raise targets suggestion',
	identities: 'Identities'
} as const;
export type LineKey = keyof typeof LINES;

/** The one number a habit shows on Today. */
export const STATS = {
	streak: 'Streak',
	consistency: 'Consistency, last 30 days',
	week: 'Done this week',
	total: 'Times done',
	/** What its main field logged last, and how far it moved in a week: "82.4 kg · −0.6 kg in a week". */
	last: 'Last value',
	none: 'Nothing'
} as const;
export type StatKey = keyof typeof STATS;

/** How much a Today row says (TS.4). Up next always says at least "open". */
export const ROWS = { names: 'names only', short: 'short rows', open: 'open rows', full: 'every line' } as const;
export type RowsKey = keyof typeof ROWS;

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
	group: str(32).default('none'),
	// Today only, each kept with its view (TS.2). The account's `today` settings are only read to migrate.
	/** How much a row says. */
	rows: z.enum(keysOf(ROWS)).default('short'),
	/** The one number on a row. */
	num: z.enum(keysOf(STATS)).default('streak'),
	/** Where finished habits go. */
	done: z.enum(keysOf(DONE_MODES)).default('bottom'),
	/** Breaking and limiting before the day. */
	first: z.boolean().default(false),
	/** Kinds of line this view leaves out, wherever a row would show them. */
	hide: z.array(z.enum(keysOf(LINES))).max(20).default([]),
	/** Only what fits the current part of the day, what is late, and anything without a time. */
	fits: z.boolean().default(false)
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
	/** Trackers: what you keep a log of, never due or missed (engine/scoring.ts). */
	tracking: 'Tracking',
	breaking: 'Breaking and limiting',
	prep: 'Prepare for tomorrow',
	paused: 'Paused',
	resting: 'Not due today'
} as const;
export type SectionKey = keyof typeof SECTIONS;
const sectionKeys = Object.keys(SECTIONS) as [SectionKey, ...SectionKey[]];


export const WIDGETS = {
	progress: 'Progress today',
	week: 'This week, day by day',
	atRisk: 'Streaks at risk',
	quit: 'Quit counters and money saved'
} as const;
export type WidgetKey = keyof typeof WIDGETS;



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
	progression: 'Raise targets suggestions',
	journal: 'Journal (the Journal page and the day note)'
} as const;
export type FeatureKey = keyof typeof FEATURES;


export const viewSettings = z.object({
	template: str(32).default('standard'),
	/** What a page opens with: the view you were on last, the page default, or a saved view (its id). */
	open: z.record(z.string().max(16), str(64)).default({}),
	/** The view each page is on: "default" or a saved view's id. What you change on the page changes that view. */
	active: z.record(z.string().max(16), str(64)).default({}),
	/** The page default each page resets to. */
	defaults: z.record(z.string().max(16), viewState).default({}),
	/** The last state of each page, from before a page remembered its view (`active`). Read only to find that view. */
	last: z.record(z.string().max(16), viewState).default({}),
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
			order: z.array(str(64)).max(500).default([]),
			/** Section and group keys that are folded. */
			folded: z.array(str(64)).max(100).default(['done', 'focus:later', 'blocks:later'])
		})
		.prefault({}),
	habits: z
		.object({ lines: z.array(z.enum(keysOf(HABIT_LINES))).default(['schedule', 'cue', 'area']) })
		.prefault({}),
	history: z.object({ values: z.boolean().default(false) }).prefault({}),
	hidden: z.array(z.enum(keysOf(FEATURES))).default([]),
	/**
	 * Your own changes on top of the template (see `Own`), kept when you switch template.
	 * Unset on views saved before this was recorded; they are worked out from the template then.
	 */
	own: z.record(z.string().max(64), z.unknown()).optional()
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
			defaults: { today: { group: 'part', sort: 'manual', fits: true } }
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
					{ key: 'tracking', show: true },
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
			defaults: { today: { rows: 'names', num: 'none', done: 'collapse' } },
			hidden: ['identities', 'levels', 'rewards', 'cost', 'prep', 'ifThen', 'reframe', 'progression']
		}
	},
	{
		id: 'gym',
		name: 'Week first',
		blurb: 'The week at a glance and your progress.',
		summary: 'Adds a week strip and progress to Today, shows "done this week" on each habit, and sorts the Library by most logged.',
		patch: {
			today: {
				widgets: ['progress', 'week'],
				done: 'bottom',
				headline: 'week',
				lines: ['cue', 'headline', 'levels', 'progression'],
				sections: [
					{ key: 'due', show: true },
					{ key: 'tracking', show: true },
					{ key: 'resting', show: true },
					{ key: 'prep', show: true },
					{ key: 'breaking', show: true },
					{ key: 'paused', show: true }
				]
			},
			hidden: ['rewards', 'cost'],
			defaults: { today: { rows: 'open', num: 'week' }, library: { sort: 'used' } }
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
					{ key: 'tracking', show: true },
					{ key: 'prep', show: false },
					{ key: 'paused', show: true },
					{ key: 'resting', show: true }
				]
			},
			defaults: { today: { first: true } },
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
			defaults: { today: { group: 'area', rows: 'full', num: 'consistency', done: 'keep' } },
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

const DEFAULT_FIELD_LABEL: Record<keyof ViewState, string> = {
	areas: 'filter',
	direction: 'filter',
	status: 'filter',
	identity: 'filter',
	habit: 'filter',
	query: 'filter',
	tags: 'filter',
	collection: 'filter',
	archived: 'filter',
	sort: 'sort',
	group: 'grouping',
	rows: 'layout',
	num: 'layout',
	done: 'layout',
	first: 'layout',
	hide: 'layout',
	fits: 'filter'
};
const stateKeys = Object.keys(DEFAULT_FIELD_LABEL) as (keyof ViewState)[];

/** List settings that hold a set of choices: your change is what you turned on and what you turned off. */
const SET_FIELDS = {
	'today.widgets': 'Widgets on Today',
	'today.lines': 'Lines on each habit',
	'habits.lines': 'Lines on the Habits list',
	hidden: 'Hidden features'
} as const;
/** Settings that are one value each. */
const ONE_FIELDS = {
	'today.sections': 'Sections of Today',
	'today.done': 'Done items',
	'today.timeAware': 'Only show what fits now',
	'today.headline': 'Headline number',
	'history.values': 'Values in History'
} as const;
type SetField = keyof typeof SET_FIELDS;
type OneField = keyof typeof ONE_FIELDS;
const setFields = Object.keys(SET_FIELDS) as SetField[];
const oneFields = Object.keys(ONE_FIELDS) as OneField[];

function getField(v: ViewSettings, f: SetField | OneField): unknown {
	switch (f) {
		case 'today.sections':
			return sectionOrder(v);
		case 'today.widgets':
		case 'today.lines':
		case 'today.done':
		case 'today.timeAware':
		case 'today.headline':
			return v.today[f.slice(6) as 'widgets'];
		case 'habits.lines':
			return v.habits.lines;
		case 'history.values':
			return v.history.values;
		case 'hidden':
			return v.hidden;
	}
}
function setField(v: ViewSettings, f: SetField | OneField, value: unknown) {
	if (f === 'hidden') v.hidden = value as FeatureKey[];
	else if (f === 'habits.lines') v.habits = { ...v.habits, lines: value as HabitLineKey[] };
	else if (f === 'history.values') v.history = { ...v.history, values: value as boolean };
	else v.today = { ...v.today, [f.slice(6)]: value };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What you turned on and off in a list setting, by hand. */
export const ownDelta = z.object({ add: z.array(str(64)).max(50), remove: z.array(str(64)).max(50) });
type Delta = z.infer<typeof ownDelta>;
const isDelta = (x: unknown): x is Delta => ownDelta.safeParse(x).success;

/**
 * Your own changes on top of the view template, by setting: "today.done" holds the value
 * you chose, a list setting like "today.lines" holds what you turned on and off, and a page
 * default holds each field you set ("defaults.today.group"). They survive a template switch.
 */
export type Own = Record<string, unknown>;

/** For views saved before own changes were recorded: everything that differs from the template. */
function deriveOwn(v: ViewSettings): Own {
	const base = fromTemplate(v.template);
	const own: Own = {};
	for (const f of oneFields) if (!same(getField(v, f), getField(base, f))) own[f] = getField(v, f);
	for (const f of setFields) {
		const mine = getField(v, f) as string[];
		const theirs = getField(base, f) as string[];
		const d = { add: mine.filter((x) => !theirs.includes(x)), remove: theirs.filter((x) => !mine.includes(x)) };
		if (d.add.length || d.remove.length) own[f] = d;
	}
	for (const p of PAGES) {
		const mine = v.defaults[p];
		const theirs = base.defaults[p];
		if (!mine || !theirs) continue;
		for (const k of stateKeys) if (!same(mine[k], theirs[k])) own[`defaults.${p}.${k}`] = mine[k];
	}
	return own;
}

/** Your own changes, recorded or (for older saved views) worked out. */
export const ownOf = (v: ViewSettings): Own => v.own ?? deriveOwn(v);

/** One setting you changed on top of your view template. */
export interface OwnChange {
	/** "today.done", "hidden", "defaults.today.grouping". */
	key: string;
	label: string;
}

/** Your own changes as a list for Settings: "Done items", "Today grouping". */
export function ownChanges(v: ViewSettings): OwnChange[] {
	const own = ownOf(v);
	const out: OwnChange[] = [];
	for (const f of [...oneFields, ...setFields])
		if (f in own) out.push({ key: f, label: (ONE_FIELDS as Record<string, string>)[f] ?? (SET_FIELDS as Record<string, string>)[f] });
	for (const p of PAGES) {
		const words = new Set(stateKeys.filter((k) => `defaults.${p}.${k}` in own).map((k) => DEFAULT_FIELD_LABEL[k]));
		for (const w of ['filter', 'sort', 'grouping']) if (words.has(w)) out.push({ key: `defaults.${p}.${w}`, label: `${PAGE_LABEL[p]} ${w}` });
	}
	return out;
}

/** Layout settings a change can name. */
export interface LayoutPatch {
	today?: Partial<ViewSettings['today']>;
	habits?: Partial<ViewSettings['habits']>;
	history?: Partial<ViewSettings['history']>;
	hidden?: FeatureKey[];
}

/**
 * Record a layout change as your own. A value set back to what the template gives stops being
 * yours. In a list, what you just turned on or off is added to what you turned on or off before,
 * so a choice the current template happens to share is still remembered for the next one.
 */
export function recordPatch(v: ViewSettings, patch: LayoutPatch): Own {
	const own = { ...ownOf(v) };
	const base = fromTemplate(v.template);
	const after = structuredClone(v);
	if (patch.today) after.today = { ...after.today, ...patch.today };
	if (patch.habits) after.habits = { ...after.habits, ...patch.habits };
	if (patch.history) after.history = { ...after.history, ...patch.history };
	if (patch.hidden) after.hidden = patch.hidden;
	const named = (f: SetField | OneField) => {
		if (f === 'hidden') return !!patch.hidden;
		const [group, key] = f.split('.') as ['today' | 'habits' | 'history', string];
		return !!patch[group] && key in patch[group]!;
	};
	for (const f of oneFields) {
		if (!named(f)) continue;
		const value = getField(after, f);
		if (same(value, getField(base, f))) delete own[f];
		else own[f] = value;
	}
	for (const f of setFields) {
		if (!named(f)) continue;
		const before = getField(v, f) as string[];
		const now = getField(after, f) as string[];
		const on = now.filter((x) => !before.includes(x));
		const off = before.filter((x) => !now.includes(x));
		const theirs = getField(base, f) as string[];
		const d = isDelta(own[f]) ? own[f] : { add: [], remove: [] };
		// Turning something off undoes an earlier "on"; it is only a "remove" of its own if the template has it.
		const next = {
			add: [...d.add.filter((x) => !off.includes(x)), ...on.filter((x) => !d.add.includes(x) && !theirs.includes(x))],
			remove: [...d.remove.filter((x) => !on.includes(x)), ...off.filter((x) => !d.remove.includes(x) && theirs.includes(x))]
		};
		if (next.add.length || next.remove.length) own[f] = next;
		else delete own[f];
	}
	return own;
}

/** Record a new page default as your own, field by field. */
export function recordDefault(v: ViewSettings, page: Page, state: ViewState): Own {
	const own = { ...ownOf(v) };
	const theirs = fromTemplate(v.template).defaults[page] ?? emptyState();
	for (const k of stateKeys) {
		if (same(state[k], theirs[k])) delete own[`defaults.${page}.${k}`];
		else own[`defaults.${page}.${k}`] = state[k];
	}
	return own;
}

/** Put your own changes on top of a template's settings. */
function applyOwn(v: ViewSettings, own: Own): ViewSettings {
	const out = structuredClone(v);
	for (const f of oneFields) if (f in own) setField(out, f, own[f]);
	for (const f of setFields) {
		const d = own[f];
		if (!isDelta(d)) continue;
		const list = getField(out, f) as string[];
		setField(out, f, [...list.filter((x) => !d.remove.includes(x)), ...d.add.filter((x) => !list.includes(x))]);
	}
	for (const p of PAGES) {
		const keys = stateKeys.filter((k) => `defaults.${p}.${k}` in own);
		if (!keys.length) continue;
		out.defaults = {
			...out.defaults,
			[p]: { ...(out.defaults[p] ?? emptyState()), ...Object.fromEntries(keys.map((k) => [k, own[`defaults.${p}.${k}`]])) }
		};
	}
	// Anything that no longer fits the schema (an old value, a removed option) falls back to the template.
	const parsed = viewSettings.safeParse(out);
	return parsed.success ? parsed.data : v;
}

/**
 * Switch template. What always belongs to you is kept: saved views, own order, per-habit
 * numbers, the start page, what each page opens with and the last filter used. With `keep`
 * (the default), your own changes on top of the old template are kept too, and the new
 * template only changes the rest. Without it, the new template replaces them.
 */
export function switchTemplate(current: ViewSettings, id: string, opts: { keep?: boolean } = {}): ViewSettings {
	const keep = opts.keep ?? true;
	const next = fromTemplate(id);
	const out: ViewSettings = {
		...next,
		saved: current.saved,
		startPage: current.startPage,
		open: current.open,
		active: current.active,
		last: current.last,
		today: { ...next.today, order: current.today.order, folded: current.today.folded, headlineFor: current.today.headlineFor },
		own: {}
	};
	if (!keep) return out;
	const own = ownOf(current);
	return { ...applyOwn(out, own), own };
}

/** Read stored views, filling anything missing. Unknown or broken data falls back to the template. */
export function readViews(raw: unknown, opts: { groupByArea?: boolean } = {}): ViewSettings {
	if (!raw) return fromTemplate('standard', opts);
	const old = oldTodayStates(raw);
	const parsed = viewSettings.safeParse(raw);
	if (!parsed.success) return fromTemplate(typeof (raw as { template?: unknown }).template === 'string' ? (raw as { template: string }).template : 'standard', opts);
	const v = parsed.data;
	for (const p of PAGES) if (!v.defaults[p]) v.defaults[p] = fromTemplate(v.template, opts).defaults[p];
	if (old.size) {
		const words = wordsFromAccount(v);
		if (old.has(DEFAULT_VIEW)) v.defaults.today = { ...v.defaults.today, ...words, ...old.get(DEFAULT_VIEW) };
		v.saved = v.saved.map((s) => (old.has(s.id) ? { ...s, state: { ...s.state, ...words, ...old.get(s.id) } } : s));
	}
	// A deleted saved view can't be what a page opens with, or the view it is on.
	for (const p of PAGES) {
		const o = v.open[p];
		if (o && o !== 'last' && o !== 'default' && !v.saved.some((s) => s.id === o)) delete v.open[p];
		if (v.active[p] && !viewStateOf(v, p, v.active[p])) delete v.active[p];
	}
	return v;
}

// ----- Today's words, kept with each view since TS.2 -----

/** Today's views stored before their words were their own, by id, with what their old layout said about grouping. */
function oldTodayStates(raw: unknown): Map<string, Partial<ViewState>> {
	const out = new Map<string, Partial<ViewState>>();
	const r = raw as { defaults?: Record<string, unknown>; saved?: unknown[] };
	const look = (id: string, s: unknown) => {
		if (!s || typeof s !== 'object' || 'rows' in s) return;
		// Round 2's layouts (TS.3): Area blocks grouped by Area, Up next first ran by time, One list had no groups.
		const layout = (s as { layout?: string }).layout;
		out.set(id, layout === 'blocks' ? { group: 'area' } : layout === 'focus' ? { group: 'none', sort: 'cue' } : layout === 'flat' ? { group: 'none' } : {});
	};
	look(DEFAULT_VIEW, r?.defaults?.today);
	for (const s of Array.isArray(r?.saved) ? r.saved : []) {
		const x = s as { id?: unknown; page?: unknown; state?: unknown };
		if (x?.page === 'today' && typeof x.id === 'string') look(x.id, x.state);
	}
	return out;
}

/** Lines a row shows only when it is open, and the ones only "every line" adds. */
const OPEN_LINES: LineKey[] = ['cue', 'levels', 'bundle'];
const FULL_LINES: LineKey[] = ['reframe', 'reward', 'identities', 'progression'];

/** The rows word and hidden lines that show what the account's "Lines on each habit" showed. */
export function rowsFromLines(lines: LineKey[]): Pick<ViewState, 'rows' | 'hide'> {
	const missing = (keys: LineKey[]) => keys.filter((k) => !lines.includes(k));
	if (FULL_LINES.some((k) => lines.includes(k))) return { rows: 'full', hide: missing([...OPEN_LINES, ...FULL_LINES]) };
	if (OPEN_LINES.some((k) => lines.includes(k))) return { rows: 'open', hide: missing(OPEN_LINES) };
	return { rows: 'short', hide: [] };
}

/**
 * The words an old Today view takes: the template's, with what you had changed by hand on the
 * account carried over (the same "own" changes a template switch keeps).
 */
export function wordsFromAccount(v: ViewSettings): Partial<ViewState> {
	const t = fromTemplate(v.template).defaults.today ?? emptyState();
	const own = ownOf(v);
	const w: Partial<ViewState> = { rows: t.rows, num: t.num, done: t.done, first: t.first, hide: t.hide, fits: t.fits };
	if ('today.done' in own) w.done = v.today.done;
	if ('today.timeAware' in own) w.fits = v.today.timeAware;
	if ('today.headline' in own) w.num = v.today.headline;
	if ('today.lines' in own) {
		Object.assign(w, rowsFromLines(v.today.lines));
		if (!v.today.lines.includes('headline')) w.num = 'none';
	}
	if ('today.sections' in own) {
		const order = sectionOrder(v).map((x) => x.key);
		w.first = order.indexOf('breaking') < order.indexOf('due');
	}
	return w;
}

/** A sentence a new Today view can start from: each template's Today words (TS.8). */
export const STARTERS = (): { id: string; name: string; state: ViewState }[] =>
	TEMPLATES.map((t) => ({ id: t.id, name: t.name, state: fromTemplate(t.id).defaults.today ?? emptyState() }));

/** The id of a page's own view, the page default. Every other view is a saved one, by its id. */
export const DEFAULT_VIEW = 'default';

/** A page's view by id, or undefined when that page has no such view. */
export function viewStateOf(v: Pick<ViewSettings, 'defaults' | 'saved'>, page: Page, id: string): ViewState | undefined {
	if (id === DEFAULT_VIEW) return v.defaults[page] ?? emptyState();
	return v.saved.find((s) => s.id === id && s.page === page)?.state;
}

/** The views a page offers, in order: its default, then the ones you saved. */
export const viewsOf = (v: Pick<ViewSettings, 'saved'>, page: Page): { id: string; name: string }[] => [
	{ id: DEFAULT_VIEW, name: 'Default' },
	...v.saved.filter((s) => s.page === page)
];

/** The view a page opens on: the one "opens with" names, else the one you were on last. */
export function initialView(v: ViewSettings, page: Page): string {
	const open = v.open[page] ?? 'last';
	if (open !== 'last') return viewStateOf(v, page, open) ? open : DEFAULT_VIEW;
	const active = v.active[page];
	if (active && viewStateOf(v, page, active)) return active;
	// Stored before the page remembered its view: the first view that shows what you used last.
	const last = v.last[page];
	return (last && viewsOf(v, page).find((x) => sameState(viewStateOf(v, page, x.id)!, last))?.id) || DEFAULT_VIEW;
}

/** The state a page opens with: a copy of its view's. */
export function initialState(v: ViewSettings, page: Page): ViewState {
	return viewState.parse(viewStateOf(v, page, initialView(v, page)) ?? {});
}

export const isHidden = (v: Pick<ViewSettings, 'hidden'>, f: FeatureKey) => v.hidden.includes(f);

/** Two states show the same thing. */
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
	ctx: { areas: { id: string; name: string; icon: string; color: string }[]; parts?: string[] },
	opts: { /** Areas with no items show too (keepsEmptyAreas). */ keepEmpty?: boolean } = {}
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
		].filter((g) => g.items.length || (opts.keepEmpty && g.key !== 'none'));
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

/**
 * What a reordered list gives back to the shared order (mergeOrder's part), when finished rows sink to the list's end
 * (Today, done at the end): only the rows on the moved row's side of that line. A move among the habits still to do
 * then never sends a done one to the end of the order for good, and the done ones keep their order among themselves.
 */
export const movedPart = (part: string[], key: string, sunk: Set<string>) => part.filter((k) => sunk.has(k) === sunk.has(key));
/**
 * Which moves the grips offer in that list: a row goes before or after the rows on its own side of the line, never across
 * it (movedPart would keep the order as it was) and never inside another row.
 */
export const sameSide = (sunk: Set<string>, m: { key: string; target: string; position: string }) => m.position !== 'inside' && sunk.has(m.key) === sunk.has(m.target);

/** Does an item pass the Area, direction and Identity filters? */
export function passes(s: ViewState, i: Groupable): boolean {
	if (s.areas.length && !s.areas.includes(i.areaId ?? '')) return false;
	if (s.direction === 'build' && i.direction === 'break') return false;
	if (s.direction === 'break' && i.direction !== 'break') return false;
	if (s.identity && !(i.identities ?? []).includes(s.identity)) return false;
	return true;
}

/** Grouped by Area with nothing narrowing the list, every Area shows, empty ones too, so each can be kept where it stands (MO). */
export const keepsEmptyAreas = (s: ViewState) => s.group === 'area' && !activeFilters(s);

/** How many filters are on. */
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
