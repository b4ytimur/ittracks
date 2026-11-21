import { fail } from '@sveltejs/kit';
import { hash, verify } from '@node-rs/argon2';
import { db } from '$lib/server/db';
import { account } from '$lib/server/db/schema';
import { checkSettings, cleanSettings } from '$lib/rules/settings';
import { getSettings, getViews, saveSettings } from '$lib/server/settings';
import { TEMPLATES } from '$lib/views';
import { publicKey, sendToAccount, subscriptionCount } from '$lib/server/push';
import { AREA_COLORS, listAreas, saveAreas } from '$lib/server/repo/areas';
import { userToday } from '$lib/server/today';
import { readRanges } from '$lib/engine/day';
import { pause } from '$lib/server/db/schema';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, cookies }) => {
	const accountId = locals.account!.id;
	return {
		settings: getSettings(accountId),
		views: getViews(accountId),
		templates: TEMPLATES.map(({ id, name, blurb, summary }) => ({ id, name, blurb, summary })),
		username: locals.account!.username,
		vapidKey: publicKey(),
		devices: subscriptionCount(accountId),
		areas: listAreas(accountId),
		colors: AREA_COLORS,
		today: userToday(accountId, cookies.get('tz')),
		vacations: db
			.select({ id: pause.id, start: pause.start, end: pause.end, note: pause.note })
			.from(pause)
			.where(and(eq(pause.accountId, accountId), isNull(pause.habitId)))
			.orderBy(asc(pause.start))
			.all()
	};
};

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const areaList = z
	.array(
		z.object({
			id: z.string().uuid().nullable(),
			name: z.string().trim().min(1).max(40),
			color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
			icon: z.string().max(8)
		})
	)
	.max(30);

export const actions: Actions = {
	units: async ({ request, locals }) => {
		const weightUnit = String((await request.formData()).get('weightUnit') ?? '').trim().slice(0, 20);
		if (!weightUnit) return fail(400, { unitsError: 'Enter a unit.' });
		saveSettings(locals.account!.id, { weightUnit });
		return { unitsSaved: true };
	},
	/** When the day starts, and its named parts. */
	day: async ({ request, locals }) => {
		const f = await request.formData();
		const dayStart = String(f.get('dayStart') ?? '');
		if (!hhmm.test(dayStart)) return fail(400, { dayError: 'Pick a time like 04:00.' });
		const ranges = readRanges(f);
		const conflict = checkSettings({ ...getSettings(locals.account!.id), dayStart, ranges })[0];
		if (conflict) return fail(400, { dayError: conflict.reason });
		saveSettings(locals.account!.id, { dayStart, ranges });
		return { daySaved: true };
	},
	/** How far back past days can be logged, and the nudge about yesterday. */
	pastDays: async ({ request, locals }) => {
		const f = await request.formData();
		const raw = String(f.get('pastDays') ?? '');
		const next = {
			...getSettings(locals.account!.id),
			pastDays: raw === '' ? null : Number(raw),
			nudgeYesterday: f.get('nudgeYesterday') === 'on'
		};
		const conflict = checkSettings(next)[0];
		if (conflict) return fail(400, { pastError: conflict.reason });
		const clean = cleanSettings(next);
		saveSettings(locals.account!.id, { pastDays: clean.pastDays, nudgeYesterday: clean.nudgeYesterday });
		return { pastSaved: true };
	},
	display: async ({ request, locals }) => {
		const f = await request.formData();
		saveSettings(locals.account!.id, {
			guidedSetup: f.get('guidedSetup') === 'on',
			showAllSections: f.get('showAllSections') === 'on'
		});
		return { displaySaved: true };
	},
	areas: async ({ request, locals }) => {
		let json: unknown;
		try {
			json = JSON.parse(String((await request.formData()).get('areas')));
		} catch {
			return fail(400, { areasError: 'Could not read the Areas.' });
		}
		const parsed = areaList.safeParse(json);
		if (!parsed.success) return fail(400, { areasError: 'Every Area needs a name.' });
		saveAreas(locals.account!.id, parsed.data);
		return { areasSaved: true };
	},
	/** A vacation pauses every habit for a date range. */
	vacation: async ({ request, locals }) => {
		const f = await request.formData();
		const start = String(f.get('start') ?? '');
		const end = String(f.get('end') ?? '');
		if (!isDate(start) || !isDate(end) || end < start) return fail(400, { vacationError: 'Pick a start and an end date.' });
		db.insert(pause)
			.values({ id: randomUUID(), accountId: locals.account!.id, habitId: null, start, end, note: String(f.get('note') ?? '').slice(0, 120) || null })
			.run();
		return { vacationSaved: true };
	},
	unvacation: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		db.delete(pause).where(and(eq(pause.id, id), eq(pause.accountId, locals.account!.id))).run();
	},
	testReminder: async ({ locals }) => {
		const sent = await sendToAccount(locals.account!.id, {
			title: 'ittracks',
			body: 'Reminders work on this device.',
			url: '/settings'
		});
		return sent ? { testSent: sent } : fail(400, { pushError: 'No device is set up for reminders yet.' });
	},
	password: async ({ request, locals }) => {
		const f = await request.formData();
		const current = String(f.get('current') ?? '');
		const next = String(f.get('next') ?? '');
		const row = db.select().from(account).where(eq(account.id, locals.account!.id)).get();
		if (!row || !(await verify(row.passwordHash, current)))
			return fail(400, { passwordError: 'Your current password is wrong.' });
		if (next.length < 8) return fail(400, { passwordError: 'Use at least 8 characters.' });
		db.update(account).set({ passwordHash: await hash(next) }).where(eq(account.id, row.id)).run();
		return { passwordSaved: true };
	}
};
