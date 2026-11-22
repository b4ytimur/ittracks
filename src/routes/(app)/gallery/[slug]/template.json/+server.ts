import { error, json } from '@sveltejs/kit';
import { getSavedTemplate } from '$lib/server/repo/saved-templates';
import { templateFileName } from '$lib/server/share';
import type { RequestHandler } from './$types';

/** Download a template you saved to your Gallery, to send it to someone. */
export const GET: RequestHandler = ({ locals, params }) => {
	if (!locals.account) error(401);
	const saved = getSavedTemplate(locals.account.id, params.slug);
	if (!saved) error(404);
	return json(saved.template, { headers: { 'content-disposition': `attachment; filename="${templateFileName(saved.template.name)}"` } });
};
