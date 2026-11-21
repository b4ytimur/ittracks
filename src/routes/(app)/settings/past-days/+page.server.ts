import { fail } from '@sveltejs/kit';
import { checkSettings, cleanSettings } from '$lib/rules/settings';
import { getSettings, saveSettings } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({ settings: getSettings(locals.account!.id) });

export const actions: Actions = {
	/** How far back past days can be logged, and the nudge about yesterday. */
	pastDays: async ({ request, locals }) => {
		const accountId = locals.account!.id;
		const f = await request.formData();
		const raw = String(f.get('pastDays') ?? '');
		const next = {
			...getSettings(accountId),
			pastDays: raw === '' ? null : Number(raw),
			nudgeYesterday: f.get('nudgeYesterday') === 'on'
		};
		const conflict = checkSettings(next).find((i) => i.severity === 'block');
		if (conflict) return fail(400, { pastError: conflict.reason });
		const clean = cleanSettings(next);
		saveSettings(accountId, { pastDays: clean.pastDays, nudgeYesterday: clean.nudgeYesterday });
		return { pastSaved: true };
	}
};
