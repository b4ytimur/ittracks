import { checkViews } from '$lib/rules/views';
import { getSettings, getViews } from '$lib/server/settings';
import { subscriptionCount } from '$lib/server/push';
import { listAreas } from '$lib/server/repo/areas';
import { listVacations } from '$lib/server/repo/vacations';
import { userToday } from '$lib/server/today';
import { FEATURES, PAGE_LABEL, TEMPLATES } from '$lib/views';
import { getStats } from '$lib/server/stats';
import { E1RM_PRESETS } from '$lib/stats/model';
import type { PageServerLoad } from './$types';

/** The Settings home: one row per section, each with a line on how it's set now. */
export const load: PageServerLoad = ({ locals, cookies }) => {
	const accountId = locals.account!.id;
	const settings = getSettings(accountId);
	const views = getViews(accountId);
	const today = userToday(accountId, cookies.get('tz'));
	const areas = listAreas(accountId);
	const vacations = listVacations(accountId).filter((v) => v.end >= today);
	return {
		username: locals.account!.username,
		dayStart: settings.dayStart ?? null,
		ranges: settings.ranges.map((r) => r.name),
		vacation: vacations[0] ?? null,
		moreVacations: Math.max(0, vacations.length - 1),
		today,
		areas: areas.map((a) => `${a.icon ? a.icon + ' ' : ''}${a.name}`),
		template: TEMPLATES.find((t) => t.id === views.template)?.name ?? 'Custom',
		startPage: PAGE_LABEL[views.startPage],
		hidden: views.hidden.filter((f) => f in FEATURES).length,
		features: Object.keys(FEATURES).length,
		viewWarnings: checkViews(views, { ranges: settings.ranges.length }).length,
		guidedSetup: settings.guidedSetup,
		showAllSections: settings.showAllSections,
		weightUnit: settings.weightUnit,
		devices: subscriptionCount(accountId),
		stats: (() => {
			const s = getStats(accountId);
			const preset = Object.values(E1RM_PRESETS).find((p) => p.formula === s.e1rm);
			return { measures: s.measures.length, e1rm: preset?.name ?? 'your own formula', boards: s.boards.length };
		})()
	};
};
