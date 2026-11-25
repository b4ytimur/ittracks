import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from './db';
import { settings, tag } from './db/schema';
import type { DayRange } from '$lib/engine/day';
import type { PastDays } from '$lib/engine/backfill';
import { PACKS, PACKS_BEFORE } from '$lib/packs';
import { PLAIN_TASK_TYPES, type TaskType } from '$lib/task-types';
import { DEFAULT_WEIGHTS, groupTable, readGroupings, starterGroupings, type Grouping, type GroupTable, type Weights } from '$lib/groupings';
import { readKinds, STARTER_KINDS, TIME, unitTable, type UnitKind, type UnitTable } from '$lib/units';
import { readViews, type ViewSettings } from '$lib/views';

export interface Settings {
	/** Before units were stored: the weight unit. Now only says what Weight is shown in until they are. */
	weightUnit: string;
	/** Kinds of units and the units in them. Unset reads as the starting ones (src/lib/units.ts). */
	units?: UnitKind[];
	/** Groupings of tags. Unset reads as the one there was before they were stored (src/lib/groupings.ts). */
	groupings?: Grouping[];
	/** IANA zone from the browser, e.g. Europe/Berlin; used for reminders. */
	timeZone?: string;
	/** HH:MM when a new day begins. Unset until the user has been asked. */
	dayStart?: string;
	/** Named parts of the day that cues can point to. */
	ranges: DayRange[];
	/** New habits open in the guided setup instead of the full editor. */
	guidedSetup: boolean;
	/** The habit editor shows every section, not just the ones in use. */
	showAllSections: boolean;
	/** Before views: Today, Habits and the Library group by Area. Now only seeds the Standard view. */
	groupByArea: boolean;
	/** Filters, sorts, layout and the view template. Unset until first saved (reads as Standard). */
	views?: ViewSettings;
	/** Habits offered as home screen shortcuts, in order. */
	pinned: string[];
	/** Task types: the ones the packs brought and the ones you saved. */
	taskTypes: TaskType[];
	/** Hints that were there once and are done with (src/lib/hints.ts). */
	hints?: string[];
	/** The order of the sections on a habit's page, per kind (src/lib/detail/sections.ts). */
	detail?: Record<string, string[]>;
	/** Starter packs copied in. Unset on an account from before there were packs: it has what used to be built in. */
	packs?: string[];
	/** The starting Areas were created once; deleting them all doesn't bring them back. */
	areasSeeded?: boolean;
	/** Stats boards, cards and custom measures (src/lib/stats/model.ts). Unset until Stats is first opened. */
	stats?: unknown;
	/** How far back past days can be logged: null any time, 0 off, N days back. */
	pastDays: PastDays;
	/** Today says when yesterday has habits left unlogged, with a link to log them. */
	nudgeYesterday: boolean;
	/** A free Markdown note per day on Today and the Day page. Off unless chosen. Part of the Journal feature. */
	dayNote: boolean;
}

const defaults: Settings = {
	weightUnit: 'kg',
	ranges: [],
	guidedSetup: true,
	showAllSections: false,
	groupByArea: false,
	pinned: [],
	taskTypes: [],
	pastDays: null,
	nudgeYesterday: true,
	dayNote: false
};

/** What an account starts with: nothing that belongs to one kind of tracking. */
export const newAccountSettings = () => ({ packs: [], units: STARTER_KINDS.filter((k) => k.id === TIME), groupings: starterGroupings(), stats: { seeded: true }, views: newViews() });
/** Nothing about identities is said when you log, unless you turn it on. */
function newViews(): ViewSettings {
	const v = readViews(undefined);
	return { ...v, today: { ...v.today, lines: v.today.lines.filter((l) => l !== 'identities') }, own: {} };
}

export function getSettings(accountId: string): Settings {
	const row = db.select().from(settings).where(eq(settings.accountId, accountId)).get();
	return { ...defaults, ...((row?.data as Partial<Settings>) ?? {}) };
}

export function saveSettings(accountId: string, next: Partial<Settings>) {
	const data = { ...getSettings(accountId), ...next };
	db.insert(settings)
		.values({ accountId, data: data as unknown as Record<string, unknown> })
		.onConflictDoUpdate({ target: settings.accountId, set: { data: data as unknown as Record<string, unknown> } })
		.run();
}

/** The account's units, with the starting ones until it changes them. */
export function getKinds(accountId: string): UnitKind[] {
	const s = getSettings(accountId);
	return readKinds(s.units, s.weightUnit);
}
export const getUnits = (accountId: string): UnitTable => unitTable(getKinds(accountId));

/** The packs an account has. */
export const getPacks = (accountId: string): string[] => getSettings(accountId).packs ?? PACKS_BEFORE;

/** What a new Task can start from: your types, then the plain ones. */
export function getTaskTypes(accountId: string): TaskType[] {
	const s = getSettings(accountId);
	const before = s.packs ? [] : PACKS.filter((p) => PACKS_BEFORE.includes(p.id)).flatMap((p) => p.types).filter((t) => !s.taskTypes.some((x) => x.key === t.key));
	const own = [...before, ...s.taskTypes];
	return [...own, ...PLAIN_TASK_TYPES.filter((t) => !own.some((x) => x.key === t.key))];
}

/** The account's groupings; before it changes them, its tags with the weights it had set in Stats. */
export function getGroupings(accountId: string): Grouping[] {
	const s = getSettings(accountId);
	const w = (s.stats as { muscle?: Partial<Weights> } | undefined)?.muscle;
	return readGroupings(s.groupings, { ...DEFAULT_WEIGHTS, ...w });
}
/** The grouping each tag was put in, by its lower-case name. */
export const tagGroups = (accountId: string): Record<string, string> =>
	Object.fromEntries(
		db
			.select({ name: tag.name, grouping: tag.grouping })
			.from(tag)
			.where(and(eq(tag.accountId, accountId), isNotNull(tag.grouping)))
			.all()
			.map((t) => [t.name.toLowerCase(), t.grouping!])
	);
export const getGroups = (accountId: string): GroupTable => groupTable(getGroupings(accountId), tagGroups(accountId));

/** The user's views, with defaults filled in. */
export function getViews(accountId: string): ViewSettings {
	const s = getSettings(accountId);
	return readViews(s.views, { groupByArea: s.groupByArea });
}

export function saveViews(accountId: string, views: ViewSettings) {
	saveSettings(accountId, { views });
}
