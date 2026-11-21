// Vacations: pauses with no habit, so every habit rests for a date range.
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { pause } from '../db/schema';

export function listVacations(accountId: string) {
	return db
		.select({ id: pause.id, start: pause.start, end: pause.end, note: pause.note })
		.from(pause)
		.where(and(eq(pause.accountId, accountId), isNull(pause.habitId)))
		.orderBy(asc(pause.start))
		.all();
}
