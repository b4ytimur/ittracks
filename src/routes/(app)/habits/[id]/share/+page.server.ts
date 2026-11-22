import { error, fail, redirect } from '@sveltejs/kit';
import { shareContext, shareField, sharedFile } from '$lib/server/share';
import { saveTemplate } from '$lib/server/repo/saved-templates';
import { describeSchedule } from '$lib/describe';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const sc = shareContext(locals.account!.id, params.id);
	if (!sc) error(404, 'Not found');
	return {
		id: params.id,
		name: sc.habit.name,
		direction: sc.habit.direction,
		schedule: describeSchedule(sc.habit.schedule, undefined, sc.habit.variants),
		ctx: sc.ctx,
		metrics: sc.metrics,
		poolNames: sc.poolNames,
		inside: sc.inside
	};
};

export const actions: Actions = {
	/** Keep the template in your own Gallery instead of downloading it: the same file. */
	save: async ({ locals, params, request }) => {
		const accountId = locals.account!.id;
		const r = sharedFile(accountId, params.id, shareField(await request.formData()));
		if ('error' in r) return fail(r.status, { error: r.error });
		redirect(303, `/gallery/${saveTemplate(accountId, r.file)}?saved=1`);
	}
};
