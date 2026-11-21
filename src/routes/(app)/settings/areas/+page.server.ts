import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { AREA_COLORS, listAreas, saveAreas } from '$lib/server/repo/areas';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({ areas: listAreas(locals.account!.id), colors: AREA_COLORS });

const areaList = z
	.array(
		z.object({
			id: z.string().uuid().nullable(),
			name: z.string().trim().min(1).max(40),
			color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
			icon: z.string().max(8)
		})
	)
	.max(30);

export const actions: Actions = {
	areas: async ({ request, locals }) => {
		let json: unknown;
		try {
			json = JSON.parse(String((await request.formData()).get('areas')));
		} catch {
			return fail(400, { areasError: 'Could not read the Areas.' });
		}
		const parsed = areaList.safeParse(json);
		if (!parsed.success) return fail(400, { areasError: 'Every Area needs a name.' });
		saveAreas(locals.account!.id, parsed.data);
		return { areasSaved: true };
	}
};
