import { listHabits } from '$lib/server/repo/habits';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	habits: listHabits(locals.account!.id).map((h) => ({ id: h.id, name: h.name }))
});
