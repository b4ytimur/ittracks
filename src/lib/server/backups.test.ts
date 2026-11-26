// A copy is the whole database, opens on its own, and only copies are ever deleted from its folder.
import { beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './db';
import { createAccount } from './auth';
import { backupNow, changePlan, folderProblem, getBackupState, getPlan, mountOf, runBackup } from './backups';

const here = { container: false, mounts: () => '' };
let dir: string;
beforeAll(async () => {
	migrate(db, { migrationsFolder: './drizzle' });
	await createAccount('backup', 'correct horse battery');
	dir = mkdtempSync(join(tmpdir(), 'ittracks-backups-'));
	return () => rmSync(dir, { recursive: true, force: true });
});

describe('turning copies on', () => {
	it('starts off', () => expect(getPlan().every).toBe(0));
	it('checks the folder, then makes the first copy at once', async () => {
		const folder = join(dir, 'nightly');
		const r = await changePlan({ every: 24, folder }, { every: 0 }, here);
		expect(r).toMatchObject({ was: { every: 0 }, now: { every: 24, folder } });
		const made = getBackupState().ok!;
		expect(made.folder).toBe(folder);
		const copy = new Database(join(folder, made.file), { readonly: true });
		expect(copy.prepare('select username from account').all()).toEqual([{ username: 'backup' }]);
		copy.close();
	});
	it('a field changed elsewhere is not overwritten', async () => {
		expect(await changePlan({ keep: 5 }, { keep: 12 }, here)).toMatchObject({ status: 409 });
		expect(await changePlan({ keep: 2 }, { keep: 30 }, here)).toMatchObject({ was: { keep: 30 }, now: { keep: 2 } });
	});
	it('a folder that cannot be used is never saved', async () => {
		writeFileSync(join(dir, 'a-file'), 'x');
		expect(await changePlan({ folder: join(dir, 'a-file') }, {}, here)).toMatchObject({ status: 400 });
		expect(await changePlan({ folder: 'relative/path' }, {}, here)).toMatchObject({ status: 400 });
		expect(getPlan().folder).toBe(join(dir, 'nightly'));
	});
});

describe('the copies in the folder', () => {
	it('keep the newest, and nothing else there is touched', async () => {
		const folder = getPlan().folder;
		writeFileSync(join(folder, 'notes.txt'), 'mine');
		await runBackup(new Date('2030-01-01T00:00:00Z'));
		await runBackup(new Date('2030-01-02T00:00:00Z'));
		await runBackup(new Date('2030-01-03T00:00:00Z'));
		expect(readdirSync(folder).sort()).toEqual(['ittracks-backup-2030-01-02T00-00-00Z.db', 'ittracks-backup-2030-01-03T00-00-00Z.db', 'notes.txt']);
	});
	it('a folder that is gone is not made again, and the line says so', async () => {
		const folder = join(dir, 'usb');
		mkdirSync(folder);
		await changePlan({ folder }, {}, here);
		rmSync(folder, { recursive: true });
		const r = await runBackup(new Date('2030-02-01T00:00:00Z'));
		expect(r.error).toMatch(/not there/);
		expect(existsSync(folder)).toBe(false);
		expect(getBackupState()).toMatchObject({ ok: { folder }, failed: { folder, at: '2030-02-01T00:00:00.000Z' } });
	});
	it('back up now doesn’t make a folder that held copies either; once it is back, it clears the failure', async () => {
		expect((await backupNow(here)).error).toMatch(/not there/);
		expect(existsSync(getPlan().folder)).toBe(false);
		mkdirSync(getPlan().folder);
		expect((await backupNow(here)).error).toBe('');
		expect(getBackupState().failed).toBeUndefined();
	});
	it('back up now makes a new folder, with copies off', async () => {
		const folder = join(dir, 'before-update');
		await changePlan({ every: 0 }, {}, here);
		await changePlan({ folder }, {}, here);
		expect((await backupNow(here)).state.ok?.folder).toBe(folder);
	});
});

describe('the folder', () => {
	it('inside a container, only a mounted folder outlives a rebuild', () => {
		const mounts = ['22 1 0:21 / / rw - overlay overlay rw', '23 22 8:1 /srv/data /data rw - ext4 /dev/sda1 rw', '24 22 8:2 / /mnt/my\\040drive rw - ext4 /dev/sdb1 rw'].join('\n');
		expect(mountOf('/data/backups', mounts)).toBe('/data');
		expect(mountOf('/mnt/my drive/x', mounts)).toBe('/mnt/my drive');
		expect(mountOf('/database', mounts)).toBe('/');
		expect(folderProblem('/app/backups', { container: true, mounts: () => mounts })).toMatch(/inside the app’s container/);
	});
	it('a folder the web server hands out is refused', () => {
		expect(folderProblem(join(process.cwd(), 'build', 'client'), here)).toMatch(/served to the web/);
	});
});
