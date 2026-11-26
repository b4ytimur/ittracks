import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

// Tests get a fresh database in memory, never the real one in ./data.
export const databasePath = env.DATABASE_PATH ?? (process.env.VITEST ? ':memory:' : './data/ittracks.db');
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });

/** The connection itself, for what Drizzle doesn't do, such as a backup. */
export const sqlite = new Database(databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
