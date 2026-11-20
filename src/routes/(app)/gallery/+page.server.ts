import { listGallery } from '$lib/gallery';
import { getSettings } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const unit = getSettings(locals.account!.id).weightUnit;
	return {
		items: listGallery(unit).map(({ slug, template: t }) => ({
			slug,
			name: t.name,
			description: t.description,
			direction: t.habit.direction,
			category: t.meta?.category ?? 'Other',
			daysPerWeek: t.meta?.daysPerWeek ?? null,
			minutesPerDay: t.meta?.minutesPerDay ?? null,
			equipment: t.meta?.equipment ?? []
		}))
	};
};
