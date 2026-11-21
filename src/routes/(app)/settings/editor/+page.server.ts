import { fail } from '@sveltejs/kit';
import { getSettings, saveSettings } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const s = getSettings(locals.account!.id);
	return { guidedSetup: s.guidedSetup, showAllSections: s.showAllSections, weightUnit: s.weightUnit };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const f = await request.formData();
		const weightUnit = String(f.get('weightUnit') ?? '').trim().slice(0, 20);
		if (!weightUnit) return fail(400, { error: 'Enter a weight unit, like kg or lb.' });
		saveSettings(locals.account!.id, {
			guidedSetup: f.get('guidedSetup') === 'on',
			showAllSections: f.get('showAllSections') === 'on',
			weightUnit
		});
		return { saved: true };
	}
};
