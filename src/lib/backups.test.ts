import { describe, expect, it } from 'vitest';
import { backupDue, backupName, backupWords, isBackupName, nextBackup, planProblem, pruneList, readPlan, type BackupPlan } from './backups';

const plan = (o: Partial<BackupPlan> = {}): BackupPlan => ({ every: 24, folder: '/data/backups', keep: 3, ...o });
const at = (iso: string) => new Date(iso);
const ok = (iso: string, folder = '/data/backups') => ({ at: iso, folder, file: backupName(at(iso)), bytes: 2_500_000 });

describe('the plan', () => {
	it('reads what is missing or wrong as the default, off', () => {
		expect(readPlan(undefined, '/d/backups')).toEqual({ every: 0, folder: '/d/backups', keep: 30 });
		expect(readPlan({ every: 5, folder: '  ', keep: 0 }, '/d/backups')).toEqual({ every: 0, folder: '/d/backups', keep: 30 });
		expect(readPlan({ every: 6, folder: '/mnt/nas', keep: 7 }, '/d')).toEqual({ every: 6, folder: '/mnt/nas', keep: 7 });
	});
	it('says why a change cannot be saved', () => {
		expect(planProblem({ every: 24, keep: 10, folder: '/backups' })).toBe('');
		expect(planProblem({ every: 2 })).toMatch(/list/);
		expect(planProblem({ keep: 0 })).toMatch(/whole number/);
		expect(planProblem({ keep: 2.5 })).toMatch(/whole number/);
		expect(planProblem({ folder: 'backups' })).toMatch(/starting with \//);
		expect(planProblem({ folder: '' })).toMatch(/Name a folder/);
	});
});

describe('when a copy is due', () => {
	const now = at('2026-11-26T12:00:00Z');
	it('never while off', () => expect(backupDue(plan({ every: 0 }), {}, now)).toBe(false));
	it('at once with none made, or none in this folder', () => {
		expect(backupDue(plan(), {}, now)).toBe(true);
		expect(backupDue(plan(), { ok: ok('2026-11-26T11:00:00Z', '/old') }, now)).toBe(true);
	});
	it('once its hours have passed since the last copy', () => {
		expect(backupDue(plan(), { ok: ok('2026-11-25T12:30:00Z') }, now)).toBe(false);
		expect(backupDue(plan(), { ok: ok('2026-11-25T12:00:00Z') }, now)).toBe(true);
		expect(nextBackup(plan(), { ok: ok('2026-11-25T12:30:00Z') }, now)).toEqual(at('2026-11-26T12:30:00Z'));
	});
	it('an hour after a failed try, even for a weekly copy; at once in another folder', () => {
		const failed = { at: '2026-11-26T11:30:00Z', folder: '/data/backups', error: 'The drive is full.' };
		expect(backupDue(plan({ every: 168 }), { failed }, now)).toBe(false);
		expect(nextBackup(plan({ every: 168 }), { failed }, now)).toEqual(at('2026-11-26T12:30:00Z'));
		expect(backupDue(plan({ every: 168 }), { failed }, at('2026-11-26T12:30:00Z'))).toBe(true);
		expect(backupDue(plan({ every: 168, folder: '/mnt/usb' }), { failed }, now)).toBe(true);
	});
});

describe('the copies in the folder', () => {
	it('are named by their time in UTC, so names sort by age', () => {
		expect(backupName(at('2026-11-26T15:13:04.120Z'))).toBe('ittracks-backup-2026-11-26T15-13-04Z.db');
		expect(isBackupName('ittracks-backup-2026-11-26T15-13-04Z.db')).toBe(true);
	});
	it('only copies are ever deleted, the oldest first', () => {
		const names = ['ittracks-backup-2026-11-24T00-00-00Z.db', 'notes.txt', 'ittracks-backup-2026-11-26T00-00-00Z.db', 'ittracks.db', 'ittracks-backup-2026-11-25T00-00-00Z.db', 'ittracks-backup-2026-11-23T00-00-00Z.db.partial', 'ittracks-backup-2026-11-22T00-00-00Z.db'];
		expect(pruneList(names, 2)).toEqual(['ittracks-backup-2026-11-24T00-00-00Z.db', 'ittracks-backup-2026-11-22T00-00-00Z.db']);
		expect(pruneList(names, 10)).toEqual([]);
	});
});

describe('the line in words', () => {
	const today = '2026-11-26';
	it('says how it is set, then how the last copy went', () => {
		expect(backupWords(plan({ every: 0 }), {}, today)).toBe('Off.');
		expect(backupWords(plan(), {}, today)).toBe('Every day to /data/backups, keeping the newest 3. The first copy is made within a minute.');
		expect(backupWords(plan({ keep: 1 }), { ok: ok('2026-11-26T12:00:00') }, today)).toMatch(/^Every day to \/data\/backups, keeping the newest copy\. Last copy today at .*, 2\.4 MB\.$/);
		expect(backupWords(plan(), { failed: { at: '2026-11-26T12:00:00', folder: '/data/backups', error: 'The drive is full.' } }, today)).toMatch(/The last try failed today at .*: The drive is full\.$/);
	});
});
