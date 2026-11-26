// Automatic backups: the plan (how often, where, how many to keep) and what was done, as data,
// with the decisions about them as pure functions. The server makes the copies (server/backups.ts).

/** How often a copy is made, in hours. 0 is off. Another choice is another row, not another branch. */
export const BACKUP_EVERY: { hours: number; label: string }[] = [
	{ hours: 0, label: 'Off' },
	{ hours: 1, label: 'Every hour' },
	{ hours: 6, label: 'Every 6 hours' },
	{ hours: 24, label: 'Every day' },
	{ hours: 168, label: 'Every week' }
];
export const KEEP_MIN = 1;
export const KEEP_MAX = 1000;
const KEEP_DEFAULT = 30;
const FOLDER_MAX = 500;
/** After a copy fails, it is tried again this soon, however long the plan waits between copies. */
export const RETRY_HOURS = 1;

export interface BackupPlan {
	/** Hours between copies; 0 is off. One of BACKUP_EVERY. */
	every: number;
	/** An absolute folder on the server. */
	folder: string;
	/** The newest this many copies in the folder stay; older ones are deleted. */
	keep: number;
}

/** What the last copies did. */
export interface BackupState {
	/** The last copy that was made. */
	ok?: { at: string; folder: string; file: string; bytes: number };
	/** The last try, when it failed after `ok`. Cleared by the next copy that is made. */
	failed?: { at: string; folder: string; error: string };
}

/** A stored plan, with whatever is missing or wrong in it set to the default. */
export function readPlan(raw: unknown, defaultFolder: string): BackupPlan {
	const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof BackupPlan, unknown>>;
	const every = BACKUP_EVERY.some((c) => c.hours === o.every) ? (o.every as number) : 0;
	const folder = typeof o.folder === 'string' && o.folder.trim() ? o.folder.trim() : defaultFolder;
	const keep = Number.isInteger(o.keep) && (o.keep as number) >= KEEP_MIN && (o.keep as number) <= KEEP_MAX ? (o.keep as number) : KEEP_DEFAULT;
	return { every, folder, keep };
}

/** Why a change to the plan can't be saved, or ''. What the folder is on the server is checked there. */
export function planProblem(p: Partial<BackupPlan>): string {
	if (p.every !== undefined && !BACKUP_EVERY.some((c) => c.hours === p.every)) return 'Pick how often from the list.';
	if (p.keep !== undefined && (!Number.isInteger(p.keep) || p.keep < KEEP_MIN || p.keep > KEEP_MAX)) return `Keep a whole number of copies, from ${KEEP_MIN} to ${KEEP_MAX}.`;
	if (p.folder !== undefined) {
		const f = p.folder.trim();
		if (!f) return 'Name a folder on the server.';
		if (f.length > FOLDER_MAX) return 'That folder name is too long.';
		if (!f.startsWith('/')) return 'Write the whole path, starting with /, such as /data/backups.';
		if (f.includes('\0')) return 'That is not a folder name.';
	}
	return '';
}

/** Whether a copy is due now: never with the plan off; at once in a new folder; an hour after a failed try. */
export function backupDue(plan: BackupPlan, state: BackupState, now: Date): boolean {
	if (!plan.every) return false;
	const hours = (iso: string) => (now.getTime() - new Date(iso).getTime()) / 3_600_000;
	if (state.failed?.folder === plan.folder && hours(state.failed.at) < Math.min(plan.every, RETRY_HOURS)) return false;
	if (!state.ok || state.ok.folder !== plan.folder) return true;
	return hours(state.ok.at) >= plan.every;
}

/** When the next copy is due, if copies are on: as soon as the check runs when one is due already. */
export function nextBackup(plan: BackupPlan, state: BackupState, now: Date): Date | null {
	if (!plan.every) return null;
	if (backupDue(plan, state, now)) return now;
	const from = state.failed?.folder === plan.folder ? { at: state.failed.at, hours: Math.min(plan.every, RETRY_HOURS) } : { at: state.ok!.at, hours: plan.every };
	return new Date(new Date(from.at).getTime() + from.hours * 3_600_000);
}

const NAME = /^ittracks-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.db$/;

/** A copy's file name: its time in UTC, so names sort by age. */
export const backupName = (at: Date) => `ittracks-backup-${at.toISOString().slice(0, 19).replace(/:/g, '-')}Z.db`;
/** Only files named like a copy are ever counted or deleted; anything else in the folder is left alone. */
export const isBackupName = (name: string) => NAME.test(name);

/** The copies to delete so the newest `keep` stay. */
export function pruneList(names: string[], keep: number): string[] {
	return names.filter(isBackupName).sort().reverse().slice(keep);
}

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const when = (iso: string, today: string) => {
	const d = new Date(iso);
	const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	return local === today ? `today at ${time}` : `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} at ${time}`;
};

/** The line in words: how it is set, then how the last copy went. */
export function backupWords(plan: BackupPlan, state: BackupState, today: string): string {
	if (!plan.every) return state.ok ? `Off. The last copy was made ${when(state.ok.at, today)}.` : 'Off.';
	const how = `${BACKUP_EVERY.find((c) => c.hours === plan.every)!.label} to ${plan.folder}, keeping ${plan.keep === 1 ? 'the newest copy' : `the newest ${plan.keep}`}.`;
	if (state.failed) return `${how} The last try failed ${when(state.failed.at, today)}: ${state.failed.error}`;
	if (state.ok?.folder === plan.folder) return `${how} Last copy ${when(state.ok.at, today)}, ${size(state.ok.bytes)}.`;
	return `${how} The first copy is made within a minute.`;
}
