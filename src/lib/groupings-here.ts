// The account's groupings on this page, from the app layout's data.
import { page } from '$app/state';
import { groupTable, starterGroupings, type Grouping, type GroupTable } from './groupings';

interface Data {
	groupings: Grouping[];
	tagGroups: Record<string, string>;
}
const tables = new WeakMap<Grouping[], GroupTable>();
const none = starterGroupings();

export function groups(): GroupTable {
	const d = page.data as Partial<Data>;
	const gs = d.groupings ?? none;
	let t = tables.get(gs);
	if (!t) tables.set(gs, (t = groupTable(gs, d.tagGroups)));
	return t;
}
