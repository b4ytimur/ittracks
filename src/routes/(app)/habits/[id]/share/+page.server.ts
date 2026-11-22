import { error } from '@sveltejs/kit';
import { shareContext } from '$lib/server/share';
import { describeSchedule } from '$lib/describe';
import type { PageServerLoad } from './$types';

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
		poolNames: sc.poolNames
	};
};
