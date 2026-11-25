import { listGallery } from '$lib/gallery';
import { getUnits } from '$lib/server/settings';
import { listSavedTemplates } from '$lib/server/repo/saved-templates';
import type { TemplateFile } from '$lib/template';
import type { PageServerLoad } from './$types';

/** What a Gallery card shows and the filters read. */
const card = (slug: string, t: TemplateFile) => ({
	slug,
	name: t.name,
	description: t.description,
	direction: t.habit.direction,
	category: t.meta?.category ?? 'Other',
	daysPerWeek: t.meta?.daysPerWeek ?? null,
	minutesPerDay: t.meta?.minutesPerDay ?? null,
	equipment: t.meta?.equipment ?? [],
	/** Habits that come inside it (a whole program). */
	inside: t.children.length
});

export const load: PageServerLoad = ({ locals }) => {
	const accountId = locals.account!.id;
	return {
		/** Saved from your own habits, newest first. */
		yours: listSavedTemplates(accountId).map((s) => card(s.id, s.template)),
		items: listGallery(getUnits(accountId)).map(({ slug, template }) => card(slug, template))
	};
};
