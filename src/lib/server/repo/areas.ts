import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { area, habit, task } from '../db/schema';
import { AREA_COLORS } from '$lib/area-colors';
import { getSettings, saveSettings } from '../settings';

export interface AreaRow {
	id: string;
	name: string;
	color: string;
	icon: string;
}


const STARTERS: Omit<AreaRow, 'id'>[] = [
	{ name: 'Fitness', color: '#65a30d', icon: '💪' },
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

/** Find an Area by name, or add it at the end when `create` is set (a template's Area you don't have yet). */
export function areaFor(accountId: string, name: string | null | undefined, create: boolean): string | null {
	const found = areaByName(accountId, name);
	if (found || !create || !name?.trim()) return found;
	const all = listAreas(accountId);
	const id = randomUUID();
	db.insert(area)
		.values({ id, accountId, name: name.trim().slice(0, 40), color: AREA_COLORS[all.length % AREA_COLORS.length], icon: '', sortOrder: all.length })
		.run();
	return id;
}

const mine = (accountId: string, id: string) => and(eq(area.id, id), eq(area.accountId, accountId));
export const areaName = (v: string) => v.trim().slice(0, 40);
export const isColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

export function changeArea(accountId: string, id: string, values: { name?: string; color?: string; icon?: string }): boolean {
	if (values.name !== undefined && !areaName(values.name)) return false;
	if (values.color !== undefined && !isColor(values.color)) return false;
	const set = { ...values, ...(values.name !== undefined ? { name: areaName(values.name) } : {}) };
	return Object.keys(set).length > 0 && db.update(area).set(set).where(mine(accountId, id)).run().changes > 0;
}

/** Add an Area at the end, or find the one that has the name already. */
export const addArea = (accountId: string, name: string): string | null => areaFor(accountId, name, true);

/** Put the Areas in this order. Areas left out keep their place after them. */
export function moveAreas(accountId: string, order: string[]) {
	const all = listAreas(accountId).map((a) => a.id);
	const next = [...order.filter((id) => all.includes(id)), ...all.filter((id) => !order.includes(id))];
	db.transaction((tx) => next.forEach((id, i) => tx.update(area).set({ sortOrder: i }).where(mine(accountId, id)).run()));
}

export interface DeletedArea {
	row: AreaRow & { sortOrder: number };
	habitIds: string[];
	taskIds: string[];
}

/** Delete an Area and say what it held, so it can be put back. Its habits and Tasks lose their Area. */
export function deleteArea(accountId: string, id: string): DeletedArea | null {
	return db.transaction((tx) => {
		const row = tx.select().from(area).where(mine(accountId, id)).get();
		if (!row) return null;
		const habitIds = tx.select({ id: habit.id }).from(habit).where(eq(habit.areaId, id)).all().map((x) => x.id);
		const taskIds = tx.select({ id: task.id }).from(task).where(eq(task.areaId, id)).all().map((x) => x.id);
		tx.delete(area).where(mine(accountId, id)).run();
		return { row: { id: row.id, name: row.name, color: row.color, icon: row.icon, sortOrder: row.sortOrder }, habitIds, taskIds };
	});
}

/** Put a deleted Area back with its id. Items given another Area since keep that one. */
export function restoreArea(accountId: string, d: DeletedArea) {
	db.transaction((tx) => {
		tx.insert(area).values({ ...d.row, accountId }).onConflictDoNothing().run();
		if (!tx.select({ id: area.id }).from(area).where(mine(accountId, d.row.id)).get()) return;
		if (d.habitIds.length) tx.update(habit).set({ areaId: d.row.id }).where(and(eq(habit.accountId, accountId), inArray(habit.id, d.habitIds), isNull(habit.areaId))).run();
		if (d.taskIds.length) tx.update(task).set({ areaId: d.row.id }).where(and(eq(task.accountId, accountId), inArray(task.id, d.taskIds), isNull(task.areaId))).run();
	});
}
