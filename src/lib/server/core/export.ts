// Full export and import. The JSON export holds everything an account has (habits, Tasks,
// logs, slips, notes, settings, the event log) and restores into any ittracks server: it is
// the backup format and the way to move between self-hosting and a hosted server. The CSV
// zip is for spreadsheets and notebooks: tidy tables with a README that explains each column.
// Keys, logins and push subscriptions are never exported: they belong to one server.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq, getTableColumns, inArray } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { db } from '../db';
import * as s from '../db/schema';
import { getSettings } from '../settings';
import { zip } from '../zip';
import { describeSchedule } from '$lib/describe';
import type { ScheduleForm } from '$lib/forms';
import { ActionError, requireScope, type Actor } from './actor';
import { emit } from './events';
import { listLogs, listValues, type LogRow, type ValueRow } from './read';

export const EXPORT_FORMAT = 'ittracks-export';
export const EXPORT_VERSION = 1;

/** Tables in the order they can be inserted (parents before children). */
const TABLES = {
	settings: s.settings,
	area: s.area,
	tag: s.tag,
	task: s.task,
	taskTag: s.taskTag,
	metric: s.metric,
	collection: s.collection,
	collectionTask: s.collectionTask,
	identity: s.identity,
	habit: s.habit,
	habitIdentity: s.habitIdentity,
	variant: s.variant,
	slot: s.slot,
	pause: s.pause,
	prepTick: s.prepTick,
	occurrence: s.occurrence,
	entry: s.entry,
	slip: s.slip,
	craving: s.craving,
	dayNote: s.dayNote,
	event: s.event
} as const;
type TableName = keyof typeof TABLES;
type Rows = Partial<Record<TableName, Record<string, unknown>[]>>;

/** The newest migration this server knows, so an export from a newer server isn't half-read. */
function schemaTag(): { tag: string; idx: number } {
	try {
		const j = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8')) as { entries: { idx: number; tag: string }[] };
		const last = j.entries.at(-1)!;
		return { tag: last.tag, idx: last.idx };
	} catch {
		return { tag: 'unknown', idx: -1 };
	}
}

/** Every row of an account, table by table. */
function accountRows(accountId: string): Rows {
	const by = (_t: SQLiteTable, rows: { r: object }[]) => rows.map((x) => ({ ...x.r }) as Record<string, unknown>);
	const habitOf = eq(s.habit.accountId, accountId);
	const taskOf = eq(s.task.accountId, accountId);
	return {
		settings: db.select().from(s.settings).where(eq(s.settings.accountId, accountId)).all(),
		area: db.select().from(s.area).where(eq(s.area.accountId, accountId)).all(),
		tag: db.select().from(s.tag).where(eq(s.tag.accountId, accountId)).all(),
		task: db.select().from(s.task).where(taskOf).all(),
		taskTag: by(s.taskTag, db.select({ r: s.taskTag }).from(s.taskTag).innerJoin(s.task, eq(s.taskTag.taskId, s.task.id)).where(taskOf).all()),
		metric: by(s.metric, db.select({ r: s.metric }).from(s.metric).innerJoin(s.task, eq(s.metric.taskId, s.task.id)).where(taskOf).all()),
		collection: db.select().from(s.collection).where(eq(s.collection.accountId, accountId)).all(),
		collectionTask: by(
			s.collectionTask,
			db.select({ r: s.collectionTask }).from(s.collectionTask).innerJoin(s.collection, eq(s.collectionTask.collectionId, s.collection.id)).where(eq(s.collection.accountId, accountId)).all()
		),
		identity: db.select().from(s.identity).where(eq(s.identity.accountId, accountId)).all(),
		habit: db.select().from(s.habit).where(habitOf).all(),
		habitIdentity: by(s.habitIdentity, db.select({ r: s.habitIdentity }).from(s.habitIdentity).innerJoin(s.habit, eq(s.habitIdentity.habitId, s.habit.id)).where(habitOf).all()),
		variant: by(s.variant, db.select({ r: s.variant }).from(s.variant).innerJoin(s.habit, eq(s.variant.habitId, s.habit.id)).where(habitOf).all()),
		slot: by(
			s.slot,
			db.select({ r: s.slot }).from(s.slot).innerJoin(s.variant, eq(s.slot.variantId, s.variant.id)).innerJoin(s.habit, eq(s.variant.habitId, s.habit.id)).where(habitOf).all()
		),
		pause: db.select().from(s.pause).where(eq(s.pause.accountId, accountId)).all(),
		prepTick: by(s.prepTick, db.select({ r: s.prepTick }).from(s.prepTick).innerJoin(s.habit, eq(s.prepTick.habitId, s.habit.id)).where(habitOf).all()),
		occurrence: by(s.occurrence, db.select({ r: s.occurrence }).from(s.occurrence).innerJoin(s.habit, eq(s.occurrence.habitId, s.habit.id)).where(habitOf).all()),
		entry: by(
			s.entry,
			db
				.select({ r: s.entry })
				.from(s.entry)
				.innerJoin(s.occurrence, eq(s.entry.occurrenceId, s.occurrence.id))
				.innerJoin(s.habit, eq(s.occurrence.habitId, s.habit.id))
				.where(habitOf)
				.all()
		),
		slip: by(s.slip, db.select({ r: s.slip }).from(s.slip).innerJoin(s.habit, eq(s.slip.habitId, s.habit.id)).where(habitOf).all()),
		craving: by(s.craving, db.select({ r: s.craving }).from(s.craving).innerJoin(s.habit, eq(s.craving.habitId, s.habit.id)).where(habitOf).all()),
		dayNote: db.select().from(s.dayNote).where(eq(s.dayNote.accountId, accountId)).all(),
		event: db.select().from(s.event).where(eq(s.event.accountId, accountId)).all()
	};
}

/** Notes, journal entries and text field values taken out, for an export without the notes scope. */
function withoutNotes(rows: Rows): Rows {
	const text = new Set((rows.metric ?? []).filter((m) => m.type === 'text').map((m) => m.id as string));
	const drop = (xs: Record<string, unknown>[] | undefined) => (xs ?? []).map((r) => ({ ...r, notes: null }));
	return {
		...rows,
		task: drop(rows.task),
		habit: drop(rows.habit),
		occurrence: drop(rows.occurrence),
		slip: drop(rows.slip),
		pause: drop(rows.pause),
		dayNote: [],
		entry: (rows.entry ?? []).map((e) => ({ ...e, values: Object.fromEntries(Object.entries(e.values as object).filter(([k]) => !text.has(k))) }))
	};
}

export interface ExportFile {
	format: typeof EXPORT_FORMAT;
	version: number;
	exportedAt: string;
	schema: string;
	app: 'ittracks';
	account: { username: string };
	includesNotes: boolean;
	counts: Record<string, number>;
	tables: Rows;
}

/** Everything as one JSON document. */
export function exportJson(actor: Actor): ExportFile {
	requireScope(actor, 'export');
	if (actor.habitIds) throw new ActionError('forbidden', 'A full export needs a key that may see every habit.');
	const account = db.select({ username: s.account.username }).from(s.account).where(eq(s.account.id, actor.accountId)).get();
	const notes = actor.scopes.has('notes');
	const raw = accountRows(actor.accountId);
	const tables = notes ? raw : withoutNotes(raw);
	// The account's own id is replaced by the importing account's, so it is left out.
	for (const rows of Object.values(tables)) for (const r of rows ?? []) delete r.accountId;
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		schema: schemaTag().tag,
		app: 'ittracks',
		account: { username: account?.username ?? '' },
		includesNotes: notes,
		counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v?.length ?? 0])),
		tables
	};
}

// ---------- CSV ----------

const cell = (v: unknown) => {
	let c = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
	// A cell a spreadsheet would run as a formula gets a leading ' unless it is a plain number.
	if (/^[=+\-@\t\r]/.test(c) && !/^[-+]?\d+(\.\d+)?$/.test(c)) c = `'${c}`;
	return /[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;
};
const csvOf = (cols: string[], rows: Record<string, unknown>[]) => [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';

const README = (notes: boolean, username: string, today: string) => `# ittracks export (CSV)

Account: ${username}. Exported ${today}. ${notes ? 'Notes and text fields are included.' : 'Notes, journal entries and text field values are left out.'}

Every table is "tidy": one row per thing, one column per property, ready for a spreadsheet,
pandas (\`pd.read_csv\`), R or an AI assistant. Dates are YYYY-MM-DD in your own time zone and
day start. To restore an account, use the JSON export instead: these files can't be imported.

## values.csv — one row per logged value

| column | meaning |
| --- | --- |
| ref | The habit-day this value belongs to, as \`log:<id>\`; the same in logs.csv, so the two join |
| date, weekday | The day it counts for |
| habit | Habit name |
| status | done, missed, skipped or due (still open) |
| variant | Which version of the habit (e.g. Day A) |
| level | minimum, target or stretch, when finished |
| task | The Task; a step (sub-task) shows as \`Task › Step\` |
| set | 1, 2, 3… for a value logged per set; empty for one logged once per log |
| field | The field's name; \`Done\` for a ticked step or Yes/no Task |
| type | number, count, duration, checkbox, choice, text, or tick |
| unit | kg, min, pages…; durations without a unit are minutes |
| value | The value |
| score | A choice's number (mood 5 to 1), when it has one |

## logs.csv — one row per habit and day, plus slips and resisted cravings

ref, kind (log, slip, craving), date, weekday, habit, status, variant, level, progress
("3 of 6 glasses"), summary (readable, e.g. "Bench press: 80 kg × 8, 8, 7"), count, time,
feeling, place${notes ? ', notes' : ''}.

## habits.csv and fields.csv

habits.csv: id, name, direction (build or break), area, schedule (in words), start_date, archived.
fields.csv: one row per field of each Task: task_id, task, field_id, field, type, unit, per_set,
options. Ids match the JSON export and the app's links.
`;

/** Tidy CSV tables in a zip, with a README describing every column. */
export function exportCsvZip(actor: Actor): { body: Uint8Array; today: string } {
	requireScope(actor, 'export');
	requireScope(actor, 'read');
	if (actor.habitIds) throw new ActionError('forbidden', 'A full export needs a key that may see every habit.');
	const notes = actor.scopes.has('notes');
	const values = listValues(actor, { from: '1970-01-01', all: true }) as unknown as { rows: ValueRow[]; to: string };
	const logs = listLogs(actor, { from: '1970-01-01', all: true }) as unknown as { rows: LogRow[] };
	const habits = db.select().from(s.habit).where(eq(s.habit.accountId, actor.accountId)).all();
	const areas = new Map(db.select().from(s.area).where(eq(s.area.accountId, actor.accountId)).all().map((a) => [a.id, a.name]));
	const tasks = db.select().from(s.task).where(eq(s.task.accountId, actor.accountId)).all();
	const metrics = tasks.length ? db.select().from(s.metric).where(inArray(s.metric.taskId, tasks.map((t) => t.id))).all() : [];
	const taskName = new Map(tasks.map((t) => [t.id, t.name]));
	const username = db.select({ u: s.account.username }).from(s.account).where(eq(s.account.id, actor.accountId)).get()?.u ?? '';
	const today = values.to;
	const files = [
		{ name: 'ittracks-export/README.md', text: README(notes, username, today) },
		{
			name: 'ittracks-export/values.csv',
			text: csvOf(['ref', 'date', 'weekday', 'habit', 'status', 'variant', 'level', 'task', 'set', 'field', 'type', 'unit', 'value', 'score'], values.rows as unknown as Record<string, unknown>[])
		},
		{
			name: 'ittracks-export/logs.csv',
			text: csvOf(
				['ref', 'kind', 'date', 'weekday', 'habit', 'status', 'variant', 'level', 'progress', 'summary', 'count', 'time', 'feeling', 'place', ...(notes ? ['notes'] : [])],
				logs.rows as unknown as Record<string, unknown>[]
			)
		},
		{
			name: 'ittracks-export/habits.csv',
			text: csvOf(
				['id', 'name', 'direction', 'area', 'schedule', 'start_date', 'archived'],
				habits.map((h) => ({
					id: h.id,
					name: h.name,
					direction: h.direction,
					area: h.areaId ? areas.get(h.areaId) : '',
					schedule: h.direction === 'build' ? describeSchedule(h.schedule as ScheduleForm | null) : '',
					start_date: h.startDate,
					archived: h.archived
				}))
			)
		},
		{
			name: 'ittracks-export/fields.csv',
			text: csvOf(
				['task_id', 'task', 'field_id', 'field', 'type', 'unit', 'per_set', 'options'],
				metrics.map((m) => ({
					task_id: m.taskId,
					task: taskName.get(m.taskId),
					field_id: m.id,
					field: m.name,
					type: m.type,
					unit: m.unit || (m.type === 'duration' ? 'min' : ''),
					per_set: m.repeats,
					options: (m.choices ?? []).join(' | ')
				}))
			)
		}
	];
	return { body: zip(files), today };
}

// ---------- import ----------

const exportFile = z.object({
	format: z.literal(EXPORT_FORMAT),
	version: z.number().int(),
	exportedAt: z.string().optional(),
	schema: z.string().optional(),
	account: z.object({ username: z.string() }).partial().optional(),
	includesNotes: z.boolean().optional(),
	tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown())))
});

export interface ImportPreview {
	username: string;
	exportedAt: string | null;
	includesNotes: boolean;
	counts: Record<string, number>;
	/** Present when the file can't be imported. */
	error?: string;
}

/** Check a file and say what it holds, without changing anything. */
export function readExport(raw: unknown): { file: z.infer<typeof exportFile>; preview: ImportPreview } | { error: string } {
	const parsed = exportFile.safeParse(raw);
	if (!parsed.success) return { error: 'This is not an ittracks export file. (A habit template goes to Habits → Import instead.)' };
	const f = parsed.data;
	if (f.version > EXPORT_VERSION) return { error: 'This export was made by a newer version of ittracks. Update this server first.' };
	const mine = schemaTag();
	const theirs = f.schema?.match(/^(\d{4})_/);
	if (theirs && mine.idx >= 0 && Number(theirs[1]) > mine.idx) return { error: 'This export was made by a newer version of ittracks. Update this server first.' };
	const unknown = Object.keys(f.tables).filter((k) => !(k in TABLES));
	if (unknown.length) return { error: `This export has tables this server doesn't know (${unknown.join(', ')}). Update this server first.` };
	return {
		file: f,
		preview: {
			username: f.account?.username ?? '',
			exportedAt: f.exportedAt ?? null,
			includesNotes: f.includesNotes ?? true,
			counts: Object.fromEntries(Object.entries(f.tables).map(([k, v]) => [k, v.length]))
		}
	};
}

/** Tables whose rows have their own id, which an import may need to renumber. */
const WITH_ID: TableName[] = ['area', 'tag', 'task', 'metric', 'collection', 'identity', 'habit', 'variant', 'slot', 'pause', 'occurrence', 'entry', 'slip', 'craving'];

/** Replace every string (and object key) that is an old id with its new one, all the way down. */
function remap(v: unknown, ids: Map<string, string>): unknown {
	if (typeof v === 'string') return ids.get(v) ?? v;
	if (Array.isArray(v)) return v.map((x) => remap(x, ids));
	if (v && typeof v === 'object' && !(v instanceof Date))
		return Object.fromEntries(Object.entries(v).map(([k, x]) => [ids.get(k) ?? k, remap(x, ids)]));
	return v;
}

/** A row from the file, shaped for its table: known columns only, dates as dates. */
function rowFor(table: SQLiteTable, raw: Record<string, unknown>, accountId: string): Record<string, unknown> {
	const cols = getTableColumns(table);
	const out: Record<string, unknown> = {};
	for (const [key, col] of Object.entries(cols)) {
		if (key === 'accountId') {
			out.accountId = accountId;
			continue;
		}
		if (table === s.event && key === 'seq') continue;
		if (!(key in raw)) continue;
		let v = raw[key];
		if (col.columnType === 'SQLiteTimestamp' && v !== null && v !== undefined) {
			const d = new Date(v as string | number);
			v = Number.isNaN(d.getTime()) ? null : d;
		} else if (col.columnType === 'SQLiteBoolean' && v !== null && v !== undefined) v = v === true || v === 1 || v === 'true';
		out[key] = v;
	}
	return out;
}

/**
 * Replace everything in this account with an export: the account keeps its login, keys and
 * devices, and everything else comes from the file. All or nothing: any failure leaves the
 * account as it was. Ids are kept, so links and Shortcuts keep working after a move, unless
 * another account on this server already uses them; then every id is renumbered.
 */
export function importReplace(actor: Actor, raw: unknown): { counts: Record<string, number>; renumbered: boolean } {
	if (actor.source !== 'app') throw new ActionError('forbidden', 'Importing replaces everything, so it can only be done in the app.');
	const r = readExport(raw);
	if ('error' in r) throw new ActionError('invalid', r.error);
	const tables = r.file.tables as Rows;
	const accountId = actor.accountId;
	const counts: Record<string, number> = {};
	let renumbered = false;
	db.transaction((tx) => {
		// Habits and Tasks take their logs, Variants, Slots, Metrics and links with them.
		tx.delete(s.habit).where(eq(s.habit.accountId, accountId)).run();
		tx.delete(s.task).where(eq(s.task.accountId, accountId)).run();
		for (const t of [s.tag, s.area, s.collection, s.identity, s.pause, s.dayNote, s.event, s.settings] as const)
			tx.delete(t).where(eq(t.accountId, accountId)).run();

		// Ids another account here already has would clash: then every id gets a new one.
		const ids = new Map<string, string>();
		const all = WITH_ID.flatMap((name) => (tables[name] ?? []).map((x) => String(x.id ?? '')));
		for (const name of WITH_ID) {
			const t = TABLES[name] as SQLiteTable & { id: typeof s.habit.id };
			const theirs = (tables[name] ?? []).map((x) => String(x.id ?? '')).filter(Boolean);
			for (let i = 0; i < theirs.length && !renumbered; i += 500)
				if (tx.select({ id: t.id }).from(t).where(inArray(t.id, theirs.slice(i, i + 500))).get()) renumbered = true;
		}
		if (renumbered) for (const id of all) if (id && !ids.has(id)) ids.set(id, randomUUID());

		for (const [name, table] of Object.entries(TABLES) as [TableName, SQLiteTable][]) {
			const rows = tables[name] ?? [];
			counts[name] = rows.length;
			for (let i = 0; i < rows.length; i++) {
				const row = rowFor(table, (renumbered ? remap(rows[i], ids) : rows[i]) as Record<string, unknown>, accountId);
				try {
					tx.insert(table).values(row as never).run();
				} catch (e) {
					throw new ActionError('invalid', `Row ${i + 1} of ${name} could not be restored (${(e as Error).message}). Nothing was changed.`);
				}
			}
		}
	});
	emit(actor, 'data.imported', { data: { counts, renumbered } });
	return { counts, renumbered };
}

/** Settings sanity after an import: the time zone of this browser wins over the file's. */
export function keepTimeZone(accountId: string, tz: string | undefined) {
	if (!tz) return;
	const cur = getSettings(accountId);
	if (cur.timeZone !== tz) db.update(s.settings).set({ data: { ...cur, timeZone: tz } }).where(eq(s.settings.accountId, accountId)).run();
}
