import { eq } from 'drizzle-orm';
import { db } from './db';
import { settings } from './db/schema';

export interface Settings {
	weightUnit: string;
}

const defaults: Settings = { weightUnit: 'kg' };

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
