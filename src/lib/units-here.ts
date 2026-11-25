// The account's units on this page, from the app layout's data.
import { page } from '$app/state';
import { STARTER_KINDS, unitTable, type UnitKind, type UnitTable } from './units';

const tables = new WeakMap<UnitKind[], UnitTable>();

export function units(): UnitTable {
	const kinds = (page.data.units as UnitKind[] | undefined) ?? STARTER_KINDS;
	let t = tables.get(kinds);
	if (!t) tables.set(kinds, (t = unitTable(kinds)));
	return t;
}
