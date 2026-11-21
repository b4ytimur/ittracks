import { error, json } from '@sveltejs/kit';
import { shareContext, shareFile, templateFileName } from '$lib/server/share';
import { shareDetails, shareForm } from '$lib/share';
import { checkShare } from '$lib/rules/share';
import { normalize } from '$lib/rules/core';
import { shareRules } from '$lib/rules/share';
import { templateFile } from '$lib/template';
import type { RequestHandler } from './$types';

const download = (file: unknown, name: string) =>
	json(file, { headers: { 'content-disposition': `attachment; filename="${templateFileName(name)}"` } });

/**
 * Download a Habit as a template file: everything it needs to work on another server,
 * including the Library Tasks its auto-filled Slots pick from and its Areas by name.
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
	const accountId = locals.account.id;
	const sc = shareContext(accountId, params.id);
	if (!sc) error(404);
	let raw: unknown;
	try {
		raw = JSON.parse(String((await request.formData()).get('share') ?? ''));
	} catch {
		error(400, 'Could not read the share form.');
	}
	const parsed = shareForm.safeParse(raw);
	if (!parsed.success) error(400, 'Could not read the share form.');
	const form = normalize(shareRules, parsed.data, sc.ctx).form;
	const block = checkShare(form, sc.ctx).find((i) => i.severity === 'block');
	if (block) error(400, block.reason);
	const file = shareFile(accountId, params.id, shareDetails(form, sc.ctx));
	// What goes out must import again.
	if (!file || !templateFile.safeParse(file).success) error(500, 'Could not build the template.');
	return download(file, file.name);
};
