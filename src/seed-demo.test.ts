// scripts/seed-demo.mjs fills a fresh database wherever it lives: a path may hold "--" or spaces.
import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('seeds a database whose path holds "--" and a space, with --flag value and --flag=value', () => {
	const dir = mkdtempSync(join(tmpdir(), 'ittracks-seed--demo '));
	try {
		const path = join(dir, 'its--data.db');
		const sqlite = new Database(path);
		migrate(drizzle(sqlite), { migrationsFolder: './drizzle' });
		sqlite.close();
		const out = execFileSync(process.execPath, ['scripts/seed-demo.mjs', '--db', path, '--create-user', 'demo:demo1234', '--today=2026-11-27'], { encoding: 'utf8' });
		expect(out).toMatch(/Added example data to "demo" \(today = 2026-11-27/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
