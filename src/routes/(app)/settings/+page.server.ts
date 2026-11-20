import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { db } from '$lib/server/db';
import { account } from '$lib/server/db/schema';
import { getSettings, saveSettings } from '$lib/server/settings';
import { publicKey, sendToAccount, subscriptionCount } from '$lib/server/push';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	settings: getSettings(locals.account!.id),
	username: locals.account!.username,
	vapidKey: publicKey(),
	devices: subscriptionCount(locals.account!.id)
});

export const actions: Actions = {
	units: async ({ request, locals }) => {
		const weightUnit = String((await request.formData()).get('weightUnit') ?? '').trim().slice(0, 20);
		if (!weightUnit) return fail(400, { unitsError: 'Enter a unit.' });
		saveSettings(locals.account!.id, { weightUnit });
		return { unitsSaved: true };
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
