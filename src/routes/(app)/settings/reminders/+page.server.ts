import { fail } from '@sveltejs/kit';
import { publicKey, sendToAccount, subscriptionCount } from '$lib/server/push';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	vapidKey: publicKey(),
	devices: subscriptionCount(locals.account!.id)
});

export const actions: Actions = {
	testReminder: async ({ locals }) => {
		const sent = await sendToAccount(locals.account!.id, {
			title: 'ittracks',
			body: 'Reminders work on this device.',
			url: '/settings/reminders'
		});
		return sent ? { testSent: sent } : fail(400, { pushError: 'No device is set up for reminders yet.' });
	}
};
