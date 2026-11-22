import { error, json } from '@sveltejs/kit';
import { shareField, sharedFile, shareFile, templateFileName } from '$lib/server/share';
import type { RequestHandler } from './$types';

const download = (file: unknown, name: string) =>
	json(file, { headers: { 'content-disposition': `attachment; filename="${templateFileName(name)}"` } });

/**
 * Download a Habit as a template file: everything it needs to work on another server,
 * including the habits inside it, the Library Tasks its auto-filled Slots pick from and its
 * Areas by name.
 */
export const GET: RequestHandler = ({ locals, params }) => {
	if (!locals.account) error(401);
	const file = shareFile(locals.account.id, params.id);
	if (!file) error(404);
	return download(file, file.habit.name);
};

/** The Share page: the same file, with a description, gallery details and questions. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.account) error(401);
	const r = sharedFile(locals.account.id, params.id, shareField(await request.formData()));
	if ('error' in r) error(r.status, r.error);
	return download(r.file, r.file.name);
};
