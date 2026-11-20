import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { galleryItem } from '$lib/gallery';
import { getSettings } from '$lib/server/settings';
import { userToday } from '$lib/server/today';
import { addTemplate } from '$lib/server/repo/templates';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import type { TemplateAnswers } from '$lib/template';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, cookies }) => {
	const accountId = locals.account!.id;
	const item = galleryItem(params.slug, getSettings(accountId).weightUnit);
	if (!item) error(404, 'Template not found');
	const library = new Set(
		db
			.select({ name: task.name })
			.from(task)
			.where(and(eq(task.accountId, accountId), isNull(task.parentTaskId), eq(task.archived, false)))
			.all()
			.map((t) => t.name.trim().toLowerCase())
	);
	return {
		slug: item.slug,
		template: item.template,
		inLibrary: item.template.tasks.filter((t) => library.has(t.name.trim().toLowerCase())).map((t) => t.key),
		today: userToday(accountId, cookies.get('tz'))
	};
};

export const actions: Actions = {
	add: async ({ request, locals, params, cookies }) => {
		const accountId = locals.account!.id;
		const item = galleryItem(params.slug, getSettings(accountId).weightUnit);
		if (!item) error(404, 'Template not found');
		const f = await request.formData();
		const answers: TemplateAnswers = {};
		for (const q of item.template.questions) {
			const name = `q_${q.key}`;
			if (q.kind === 'days') answers[q.key] = f.getAll(name).map(Number).filter((d) => Number.isInteger(d));
			else if (q.kind === 'number') {
				const n = Number(f.get(name));
				if (f.get(name) !== '' && Number.isFinite(n)) answers[q.key] = n;
			} else answers[q.key] = String(f.get(name) ?? '');
		}
		const tpl = structuredClone(item.template);
		const name = String(f.get('name') ?? '').trim().slice(0, 120);
		if (name) tpl.habit.name = name;
		const r = addTemplate(accountId, tpl, {
			today: userToday(accountId, cookies.get('tz')),
			answers,
			reuse: f.get('separate') !== 'on'
		});
		if ('error' in r) return fail(400, { error: r.error });
		redirect(303, `/habits?added=${encodeURIComponent(r.name)}`);
	}
};
