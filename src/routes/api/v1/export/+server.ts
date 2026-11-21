// Full export for backups and analysis: ?format=json (default, restorable) or ?format=csv
// (tidy tables in a zip). Needs the "export" access; notes only with "notes" too.
import { apiActor, bearer, fail, unauthorized } from '$lib/server/core/http';
import { exportCsvZip, exportJson } from '$lib/server/core/export';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	const actor = apiActor(event);
	if (!actor) return unauthorized(!!bearer(event.request));
	try {
		if (event.url.searchParams.get('format') === 'csv') {
			const { body, today } = exportCsvZip(actor);
			return new Response(body as unknown as BodyInit, {
				headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="ittracks-export-${today}.zip"`, 'cache-control': 'no-store' }
			});
		}
		const file = exportJson(actor);
		return new Response(JSON.stringify(file), {
			headers: {
				'content-type': 'application/json',
				'content-disposition': `attachment; filename="ittracks-export-${file.exportedAt.slice(0, 10)}.json"`,
				'cache-control': 'no-store'
			}
		});
	} catch (e) {
		return fail(e);
	}
};
