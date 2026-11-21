// J6: the whole journal as Markdown, one file per day (2026-11-21.md) in a zip, in the
// style of Obsidian daily notes: unzip it into a vault folder. Only the owner can download it.
import { error } from '@sveltejs/kit';
import { getViews } from '$lib/server/settings';
import { userToday } from '$lib/server/today';
import { loadJournal } from '$lib/server/journal';
import { zip } from '$lib/server/zip';
import { dayMarkdown } from '$lib/journal';
import { isHidden } from '$lib/views';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, cookies }) => {
	const accountId = locals.account?.id;
	if (!accountId) error(401, 'Sign in first');
	if (isHidden(getViews(accountId), 'journal')) error(404, 'The Journal is switched off');
	const today = userToday(accountId, cookies.get('tz'));
	const days = loadJournal(accountId, { from: '0000-01-01', to: today }, { today });
	const files = days.map((d) => ({ name: `ittracks-journal/${d.date}.md`, text: dayMarkdown(d) }));
	const body = zip(files.length ? files : [{ name: 'ittracks-journal/README.md', text: '# Journal\n\nNothing written yet.\n' }]);
	return new Response(body as unknown as BodyInit, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="ittracks-journal-${today}.zip"`,
			'cache-control': 'no-store'
		}
	});
};
