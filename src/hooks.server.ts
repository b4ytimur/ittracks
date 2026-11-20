import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '$lib/server/db';

// Bring the database up to date on startup, so self-hosters never run migrations by hand.
migrate(db, { migrationsFolder: './drizzle' });
