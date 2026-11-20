// Push reminders at a Habit's cue time. The server generates its own push keys on
// first start and keeps them in the database, so self-hosters have nothing to set up.
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { appValue, habit, pushSubscription, reminderSent } from './db/schema';
import { getSettings } from './settings';
import { ensureToday, timeIn, todayIn } from './today';
import type { ScheduleForm } from '$lib/forms';

const KEY = 'vapid';
/** A reminder that is this late (server was off) is dropped rather than sent. */
const LATE_LIMIT_MIN = 120;

function vapid(): { publicKey: string; privateKey: string } {
	const row = db.select().from(appValue).where(eq(appValue.key, KEY)).get();
	if (row) return JSON.parse(row.value);
	const keys = webpush.generateVAPIDKeys();
	db.insert(appValue).values({ key: KEY, value: JSON.stringify(keys) }).onConflictDoNothing().run();
	return JSON.parse(db.select().from(appValue).where(eq(appValue.key, KEY)).get()!.value);
}

export const publicKey = () => vapid().publicKey;

export interface BrowserSubscription {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

export function subscribe(accountId: string, s: BrowserSubscription) {
	db.insert(pushSubscription)
		.values({ id: randomUUID(), accountId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth })
		.onConflictDoUpdate({
			target: pushSubscription.endpoint,
			set: { accountId, p256dh: s.keys.p256dh, auth: s.keys.auth }
		})
		.run();
}

export function unsubscribe(accountId: string, endpoint: string) {
	db.delete(pushSubscription)
		.where(and(eq(pushSubscription.accountId, accountId), eq(pushSubscription.endpoint, endpoint)))
		.run();
}

export function subscriptionCount(accountId: string) {
	return db.select({ id: pushSubscription.id }).from(pushSubscription).where(eq(pushSubscription.accountId, accountId)).all()
		.length;
}

export interface PushMessage {
	title: string;
	body: string;
	url: string;
	tag?: string;
	/** Lets the notification act on this Occurrence: Done, Minimum, Snooze. */
	occurrenceId?: string;
	actions?: { action: string; title: string }[];
}

/** Send to every browser of an account. Browsers that unsubscribed are forgotten. */
export async function sendToAccount(accountId: string, msg: PushMessage): Promise<number> {
	const subs = db.select().from(pushSubscription).where(eq(pushSubscription.accountId, accountId)).all();
	if (!subs.length) return 0;
	const keys = vapid();
	let sent = 0;
	await Promise.all(
		subs.map(async (s) => {
			try {
				await webpush.sendNotification(
					{ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
					JSON.stringify(msg),
					{ vapidDetails: { subject: 'mailto:reminders@ittracks.invalid', ...keys }, TTL: 60 * 60 }
				);
				sent++;
			} catch (e) {
				const code = (e as { statusCode?: number }).statusCode;
				if (code === 404 || code === 410) db.delete(pushSubscription).where(eq(pushSubscription.id, s.id)).run();
				else console.warn('Push failed', code ?? e);
			}
		})
	);
	return sent;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clock = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export const SNOOZE_MIN = 30;

/** Ask for the reminder again in 30 minutes. */
export function snooze(habitId: string, date: string, now: string) {
	const againAt = clock(Math.min(minutes(now) + SNOOZE_MIN, 23 * 60 + 59));
	db.insert(reminderSent)
		.values({ habitId, date, againAt })
		.onConflictDoUpdate({ target: [reminderSent.habitId, reminderSent.date], set: { againAt } })
		.run();
}

/** Send every reminder that is due now. Runs once a minute. */
export async function runReminders(at = new Date()) {
	const accounts = [
		...new Set(db.select({ accountId: pushSubscription.accountId }).from(pushSubscription).all().map((r) => r.accountId))
	];
	for (const accountId of accounts) {
		const settings = getSettings(accountId);
		const tz = settings.timeZone;
		const today = todayIn(tz, settings.dayStart ?? '00:00', at);
		const nowClock = timeIn(tz, at);
		const now = minutes(nowClock);
		const habits = db
			.select()
			.from(habit)
			.where(and(eq(habit.accountId, accountId), eq(habit.remind, true), eq(habit.archived, false)))
			.all();
		for (const h of habits) {
			// A cue that names only a part of the day reminds at that part's start.
			const time = h.cue?.time ?? settings.ranges.find((r) => r.name === h.cue?.range)?.start;
			if (!time || h.direction !== 'build' || !h.schedule) continue;
			const sent = db
				.select()
				.from(reminderSent)
				.where(and(eq(reminderSent.habitId, h.id), eq(reminderSent.date, today)))
				.get();
			if (sent) {
				// Snoozed: send again once its time comes, then clear it.
				if (!sent.againAt || minutes(sent.againAt) > now) continue;
				db.update(reminderSent)
					.set({ againAt: null })
					.where(and(eq(reminderSent.habitId, h.id), eq(reminderSent.date, today)))
					.run();
			} else {
				const late = (now - minutes(time) + 1440) % 1440;
				if (late > LATE_LIMIT_MIN) continue;
				db.insert(reminderSent).values({ habitId: h.id, date: today }).onConflictDoNothing().run();
			}
			const occ = ensureToday(accountId, h.id, h.schedule as ScheduleForm, today);
			if (!occ || occ.status !== 'due') continue;
			const minimum = h.levels?.enabled && h.levels.minimum ? `Even ${h.levels.minimum} counts.` : '';
			const actions = [{ action: 'done', title: 'Done' }];
			if (h.levels?.enabled) actions.push({ action: 'minimum', title: 'Minimum' });
			actions.push({ action: 'snooze', title: `Snooze ${SNOOZE_MIN} min` });
			await sendToAccount(accountId, {
				title: h.name,
				body: [[h.cue?.time ?? h.cue?.range, h.cue?.place].filter(Boolean).join(' '), minimum].filter(Boolean).join(' · '),
				url: '/',
				tag: `habit-${h.id}`,
				occurrenceId: occ.id,
				actions
			});
		}
	}
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Start the once-a-minute reminder loop. Safe to call more than once. */
export function startReminders() {
	const g = globalThis as { __ittracksReminders?: boolean };
	if (g.__ittracksReminders) return;
	g.__ittracksReminders = true;
	timer = setInterval(() => {
		runReminders().catch((e) => console.error('Reminders failed', e));
	}, 60_000);
	timer.unref?.();
}
