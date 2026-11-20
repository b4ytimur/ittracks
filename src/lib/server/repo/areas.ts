import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { area } from '../db/schema';
import { getSettings, saveSettings } from '../settings';

export interface AreaRow {
	id: string;
	name: string;
	color: string;
	icon: string;
}

export const AREA_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777'];

const STARTERS: Omit<AreaRow, 'id'>[] = [
	{ name: 'Fitness', color: '#2563eb', icon: '💪' },
	{ name: 'Learning', color: '#9333ea', icon: '📚' },
	{ name: 'Health', color: '#16a34a', icon: '🍎' },
	{ name: 'Mind', color: '#0891b2', icon: '🧘' }
];

/** The account's Areas in order. The starting four are created the first time. */
export function listAreas(accountId: string): AreaRow[] {
	if (!getSettings(accountId).areasSeeded) {
		db.transaction((tx) => {
			const any = tx.select({ id: area.id }).from(area).where(eq(area.accountId, accountId)).get();
			if (!any)
				STARTERS.forEach((a, i) => tx.insert(area).values({ id: randomUUID(), accountId, ...a, sortOrder: i }).run());
		});
		saveSettings(accountId, { areasSeeded: true });
	}
	return db
		.select({ id: area.id, name: area.name, color: area.color, icon: area.icon })
		.from(area)
		.where(eq(area.accountId, accountId))
		.orderBy(asc(area.sortOrder), asc(area.name))
		.all();
}

/** Find an Area by name (any case), for templates that suggest one. */
export function areaByName(accountId: string, name: string | null | undefined): string | null {
	if (!name) return null;
	return listAreas(accountId).find((a) => a.name.toLowerCase() === name.toLowerCase())?.id ?? null;
}

/** Replace the account's Areas with this ordered list. Rows not listed are deleted; their items lose the Area. */
export function saveAreas(accountId: string, rows: (Omit<AreaRow, 'id'> & { id: string | null })[]) {
	db.transaction((tx) => {
		const existing = new Set(
			tx.select({ id: area.id }).from(area).where(eq(area.accountId, accountId)).all().map((r) => r.id)
		);
		const keep = new Set<string>();
		rows.forEach((r, i) => {
			const values = { name: r.name, color: r.color, icon: r.icon, sortOrder: i };
			if (r.id && existing.has(r.id)) {
				tx.update(area).set(values).where(and(eq(area.id, r.id), eq(area.accountId, accountId))).run();
				keep.add(r.id);
			} else tx.insert(area).values({ id: randomUUID(), accountId, ...values }).run();
		});
		for (const id of existing) if (!keep.has(id)) tx.delete(area).where(eq(area.id, id)).run();
	});
}
