import { eq } from 'drizzle-orm';
import { db } from './db';
import { settings } from './db/schema';
import type { DayRange } from '$lib/engine/day';
import type { TaskType } from '$lib/task-types';

export interface Settings {
	weightUnit: string;
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
	/** Today, Habits and the Library group by Area. */
	groupByArea: boolean;
	/** Habits offered as home screen shortcuts, in order. */
	pinned: string[];
	/** Task types the user saved, offered next to the built-in ones. */
	taskTypes: TaskType[];
	/** The starting Areas were created once; deleting them all doesn't bring them back. */
	areasSeeded?: boolean;
}

const defaults: Settings = {
	weightUnit: 'kg',
	ranges: [],
	guidedSetup: true,
	showAllSections: false,
	groupByArea: false,
	pinned: [],
	taskTypes: []
};

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
