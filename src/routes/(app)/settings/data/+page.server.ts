import { fail } from '@sveltejs/kit';
import { listHabits } from '$lib/server/repo/habits';
import { ActionError, appActor } from '$lib/server/core/actor';
import { importReplace, keepTimeZone, readExport } from '$lib/server/core/export';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	habits: listHabits(locals.account!.id).map((h) => ({ id: h.id, name: h.name }))
});

/** Plenty for years of logs; the server's BODY_SIZE_LIMIT has to allow it too. */
const MAX_IMPORT = 50 * 1024 * 1024;

async function fileFrom(request: Request): Promise<{ raw: unknown; form: FormData } | { error: string }> {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return { error: 'The file is too big for this server. Raise BODY_SIZE_LIMIT (see the README) and try again.' };
	}
	const file = form.get('file');
	if (!(file instanceof File) || !file.size) return { error: 'Pick an export file first.' };
	if (file.size > MAX_IMPORT) return { error: 'That file is bigger than 50 MB, so it is not an ittracks export.' };
	try {
		return { raw: JSON.parse(await file.text()), form };
	} catch {
		return { error: 'This is not an ittracks export file (it is not JSON).' };
	}
}

export const actions: Actions = {
	/** Say what a file holds, without changing anything. */
	preview: async ({ request }) => {
		const got = await fileFrom(request);
		if ('error' in got) return fail(400, { importError: got.error });
		const r = readExport(got.raw);
		if ('error' in r) return fail(400, { importError: r.error });
		return { preview: r.preview };
	},
	import: async ({ request, locals, cookies }) => {
		const got = await fileFrom(request);
		if ('error' in got) return fail(400, { importError: got.error });
		if (got.form.get('confirm') !== 'yes') return fail(400, { importError: 'Tick the box to confirm that this replaces your data.' });
		try {
			const r = importReplace(appActor(locals.account!.id, cookies.get('tz')), got.raw);
			keepTimeZone(locals.account!.id, cookies.get('tz'));
			return { imported: r.counts, renumbered: r.renumbered };
		} catch (e) {
			if (e instanceof ActionError) return fail(400, { importError: e.message });
			throw e;
		}
	}
};
