// Automatic backups: a consistent copy of the whole database (SQLite's online backup, so the app
// keeps running), written to a folder on the server as often as Settings says. The plan and what
// the last copies did are kept in app_value: they belong to this server, not to an account's data,
// so an export or a restored export never carries them.
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { databasePath, db, sqlite } from './db';
import { appValue } from './db/schema';
import { backupDue, backupName, planProblem, pruneList, readPlan, type BackupPlan, type BackupState } from '$lib/backups';

const PLAN = 'backup-plan';
const STATE = 'backup-state';

function read(key: string): unknown {
	const row = db.select().from(appValue).where(eq(appValue.key, key)).get();
	try {
		return row ? JSON.parse(row.value) : undefined;
	} catch {
		return undefined;
	}
}
function write(key: string, value: unknown) {
	const v = JSON.stringify(value);
	db.insert(appValue).values({ key, value: v }).onConflictDoUpdate({ target: appValue.key, set: { value: v } }).run();
}

/** `backups` next to the database: /data/backups in Docker, which is data/backups next to docker-compose.yml. */
export const defaultFolder = () => join(dirname(resolve(databasePath === ':memory:' ? './data/ittracks.db' : databasePath)), 'backups');
export const getPlan = (): BackupPlan => readPlan(read(PLAN), defaultFolder());
export const getBackupState = (): BackupState => (read(STATE) as BackupState | undefined) ?? {};

/** Running in Docker or Podman. */
export const inContainer = () => existsSync('/.dockerenv') || existsSync('/run/.containerenv');

/** The mount point a path is on, from the text of /proc/self/mountinfo. */
export function mountOf(path: string, mountinfo: string): string {
	const points = mountinfo
		.split('\n')
		.map((l) => l.split(' ')[4])
		.filter(Boolean)
		.map((m) => m.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))));
	return points.filter((m) => m === '/' || path === m || path.startsWith(m + '/')).sort((a, b) => b.length - a.length)[0] ?? '/';
}

const ERRORS: Record<string, string> = {
	EACCES: 'The app isn’t allowed to write there.',
	EPERM: 'The app isn’t allowed to write there.',
	EROFS: 'That drive can only be read.',
	ENOSPC: 'The drive is full.',
	ENOTDIR: 'Part of that path is a file, not a folder.',
	ENOENT: 'That folder is not there.'
};
const say = (e: unknown) => (e instanceof Said ? e.message : (ERRORS[(e as { code?: string }).code ?? ''] ?? (e as Error).message ?? String(e)));
class Said extends Error {}

/** What a folder is checked against: whether the app runs in a container, and its mount table. */
export interface Server {
	container: boolean;
	mounts: () => string;
}
const thisServer = (): Server => ({ container: inContainer(), mounts: () => readFileSync('/proc/self/mountinfo', 'utf8') });

/** Why copies can't go in this folder, or ''. Makes the folder when it can. */
export function folderProblem(folder: string, where: Server = thisServer()): string {
	const plain = planProblem({ folder });
	if (plain) return plain;
	const path = resolve(folder.trim());
	if (['build', 'static'].some((d) => path === resolve(d) || path.startsWith(resolve(d) + '/'))) return 'That folder is served to the web, so anyone could download the copies.';
	if (where.container) {
		let mount = '';
		try {
			mount = mountOf(path, where.mounts());
		} catch {
			// No mount table to read: the folder is checked as on any server.
		}
		if (mount === '/') return `That folder is inside the app’s container, so rebuilding the app deletes it. Use ${defaultFolder()}, or mount a folder in docker-compose.yml and use its path.`;
	}
	try {
		mkdirSync(path, { recursive: true });
		if (!statSync(path).isDirectory()) return 'That is a file, not a folder.';
		accessSync(path, constants.W_OK);
	} catch (e) {
		return say(e);
	}
	return '';
}

let running: Promise<{ state: BackupState; error: string }> | null = null;

/**
 * Make a copy now, in the plan's folder, and delete the oldest beyond the plan's count. One at a
 * time: a second call while one runs gets the same copy. The folder has to be there already, so a
 * drive that is not connected never gets its copies written to the disk under it.
 */
export function runBackup(now = new Date()): Promise<{ state: BackupState; error: string }> {
	return (running ??= make(getPlan(), now).finally(() => (running = null)));
}

async function make(plan: BackupPlan, now: Date): Promise<{ state: BackupState; error: string }> {
	const at = now.toISOString();
	const file = backupName(now);
	const part = join(plan.folder, `${file}.partial`);
	let state: BackupState;
	let error = '';
	try {
		if (!existsSync(plan.folder) || !statSync(plan.folder).isDirectory()) throw new Said(`The folder ${plan.folder} is not there. Is its drive connected?`);
		// Written under another name first, so a copy cut short never looks like one, nor is counted.
		await sqlite.backup(part);
		renameSync(part, join(plan.folder, file));
		const bytes = statSync(join(plan.folder, file)).size;
		for (const old of pruneList(readdirSync(plan.folder), plan.keep)) rmSync(join(plan.folder, old), { force: true });
		state = { ok: { at, folder: plan.folder, file, bytes } };
	} catch (e) {
		try {
			rmSync(part, { force: true });
		} catch {
			// The folder itself is gone: there is nothing to tidy.
		}
		error = say(e);
		state = { ...getBackupState(), failed: { at, folder: plan.folder, error } };
		console.error('Backup failed', e);
	}
	write(STATE, state);
	return { state, error };
}

type PlanChange = { was: Partial<BackupPlan>; now: Partial<BackupPlan>; state: BackupState };

/** Only the plan's own fields, each of its own type; anything else is not a change to it. */
export function readChange(raw: unknown): Partial<BackupPlan> | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const out: Partial<BackupPlan> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (k === 'folder' && typeof v === 'string') out.folder = v.trim();
		else if ((k === 'every' || k === 'keep') && typeof v === 'number') out[k] = v;
		else return null;
	}
	return out;
}

/**
 * Change some of the plan. `was` is what the page showed: a field that changed elsewhere since is
 * not overwritten. A new folder, or turning copies on, makes the first copy at once, so the line
 * says straight away whether copies can be made there.
 */
export async function changePlan(set: Partial<BackupPlan>, was: Partial<BackupPlan>, where: Server = thisServer()): Promise<PlanChange | { error: string; status: number }> {
	const why = planProblem(set);
	if (why) return { error: why, status: 400 };
	const plan = getPlan();
	const keys = Object.keys(set) as (keyof BackupPlan)[];
	if (keys.some((k) => k in was && was[k] !== plan[k])) return { error: 'This changed on another device, and is shown as it is there now.', status: 409 };
	const next: BackupPlan = { ...plan, ...set };
	const newFolder = next.folder !== plan.folder;
	const turnedOn = !!next.every && !plan.every;
	if (newFolder || turnedOn) {
		const there = folderProblem(next.folder, where);
		if (there) return { error: there, status: 400 };
	}
	write(PLAN, next);
	const state = next.every && (newFolder || turnedOn) ? (await runBackup()).state : getBackupState();
	const pick = (p: BackupPlan) => Object.fromEntries(keys.map((k) => [k, p[k]])) as Partial<BackupPlan>;
	return { was: pick(plan), now: pick(next), state };
}

/**
 * A copy now, whether or not copies are on: before an update, say. The folder is made only when no
 * copy has gone there yet: one that held copies and is gone is more likely a drive not connected.
 */
export async function backupNow(where: Server = thisServer()): Promise<{ state: BackupState; error: string }> {
	const plan = getPlan();
	const why = getBackupState().ok?.folder === plan.folder ? '' : folderProblem(plan.folder, where);
	if (why) return { state: getBackupState(), error: why };
	return runBackup();
}

/** Check once a minute whether a copy is due. Safe to call more than once. */
export function startBackups() {
	const g = globalThis as { __ittracksBackups?: boolean };
	if (g.__ittracksBackups) return;
	g.__ittracksBackups = true;
	const timer = setInterval(() => {
		try {
			if (backupDue(getPlan(), getBackupState(), new Date())) runBackup().catch((e) => console.error('Backup failed', e));
		} catch (e) {
			console.error('Backup check failed', e);
		}
	}, 60_000);
	timer.unref?.();
}
