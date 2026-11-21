import { fail } from '@sveltejs/kit';
import { checkSettings } from '$lib/rules/settings';
import { getSettings, getViews, saveSettings } from '$lib/server/settings';
import { readRenames, renameRanges, usedRanges } from '$lib/server/repo/ranges';
import { duplicateRange, readRanges } from '$lib/engine/day';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const accountId = locals.account!.id;
	return { settings: getSettings(accountId), views: getViews(accountId), used: usedRanges(accountId) };
};

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

export const actions: Actions = {
	/** When the day starts, and its named parts. */
	day: async ({ request, locals }) => {
		const accountId = locals.account!.id;
		const f = await request.formData();
		const dayStart = String(f.get('dayStart') ?? '');
		if (!hhmm.test(dayStart)) return fail(400, { dayError: 'Pick a time like 04:00.' });
		const twice = duplicateRange(f);
		if (twice) return fail(400, { dayError: `Two parts of the day are called “${twice}”. Give each its own name.` });
		const ranges = readRanges(f);
		const conflict = checkSettings({ ...getSettings(accountId), dayStart, ranges }).find((i) => i.severity === 'block');
		if (conflict) return fail(400, { dayError: conflict.reason });
		saveSettings(accountId, { dayStart, ranges });
		renameRanges(accountId, readRenames(f, ranges));
		return { daySaved: true };
	}
};
