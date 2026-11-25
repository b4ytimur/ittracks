import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { galleryItem, PACK_OF } from '$lib/gallery';
import { bringsLine } from '$lib/packs';
import { missingPacks, takePacks, undoPack, unitsWith } from '$lib/server/packs';
import { getUnits } from '$lib/server/settings';
import { userToday } from '$lib/server/today';
import { addTemplate, addedPath, readAddForm } from '$lib/server/repo/templates';
import { deleteSavedTemplate, getSavedTemplate } from '$lib/server/repo/saved-templates';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { listHabits } from '$lib/server/repo/habits';
import { listAreas } from '$lib/server/repo/areas';
import type { TemplateFile } from '$lib/template';
import type { Actions, PageServerLoad } from './$types';

/** The packs a template brings that the account hasn't taken: a ready-made one's, or those a saved file names. */
const packsFor = (accountId: string, slug: string) =>
	missingPacks(accountId, PACK_OF[slug] ? [PACK_OF[slug]] : (getSavedTemplate(accountId, slug)?.template.packs ?? []));

/** A ready-made template, or one you saved (by its id): `mine` says which. */
function find(accountId: string, slug: string): { template: TemplateFile; mine: boolean } | null {
	const pack = PACK_OF[slug] ? packsFor(accountId, slug)[0] : undefined;
	const builtIn = galleryItem(slug, pack ? unitsWith(accountId, pack.id) : getUnits(accountId));
	if (builtIn) return { template: builtIn.template, mine: false };
	const saved = getSavedTemplate(accountId, slug);
	return saved ? { template: saved.template, mine: true } : null;
}

export const load: PageServerLoad = ({ locals, params, cookies, url }) => {
	const accountId = locals.account!.id;
	const item = find(accountId, params.slug);
	if (!item) error(404, 'Template not found');
	const names = (rows: { name: string }[]) => rows.map((r) => r.name.trim().toLowerCase());
	return {
		slug: params.slug,
		template: item.template,
		mine: item.mine,
		/** The packs that come with it, when they aren't there yet, in words. */
		brings: bringsLine(packsFor(accountId, params.slug)),
		saved: url.searchParams.has('saved'),
		libraryNames: names(
			db.select({ name: task.name }).from(task).where(and(eq(task.accountId, accountId), isNull(task.parentTaskId), eq(task.archived, false))).all()
		),
		habitNames: names(listHabits(accountId)),
		areaNames: names(listAreas(accountId)),
		today: userToday(accountId, cookies.get('tz'))
	};
};

export const actions: Actions = {
	add: async ({ request, locals, params, cookies }) => {
		const accountId = locals.account!.id;
		// First, so its Tasks find their units and tags; taken out again when the habit isn't added.
		const taken = takePacks(accountId, packsFor(accountId, params.slug).map((p) => p.id));
		const item = find(accountId, params.slug);
		if (!item) error(404, 'Template not found');
		const add = readAddForm(await request.formData(), item.template);
		const r = addTemplate(accountId, add.tpl, { today: userToday(accountId, cookies.get('tz')), ...add });
		if ('error' in r) {
			if (taken) undoPack(accountId, taken);
			return fail(400, { error: r.error });
		}
		return { added: { name: r.name, path: addedPath(r, add.tpl.view), made: r.made, pack: taken } };
	},
	/** Take a template you saved out of your Gallery. The habits added from it stay. */
	delete: ({ locals, params }) => {
		if (!deleteSavedTemplate(locals.account!.id, params.slug)) error(404, 'Template not found');
		redirect(303, '/gallery');
	}
};
