import { checkSettings, journalOff } from '$lib/rules/settings';
import { getSettings, saveSettings } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const s = getSettings(locals.account!.id);
	return { dayNote: s.dayNote, off: journalOff(s) };
};

export const actions: Actions = {
	/** J3: the day note on Today and the Day page. */
	save: async ({ request, locals }) => {
		const accountId = locals.account!.id;
		const f = await request.formData();
		const next = { ...getSettings(accountId), dayNote: f.get('dayNote') === 'on' };
		saveSettings(accountId, { dayNote: next.dayNote });
		// Never blocks: with the Journal feature off, the note just stays hidden (rules/settings.ts).
		return { saved: true, warnings: checkSettings(next).filter((i) => i.path === 'dayNote').map((i) => i.reason) };
	}
};
