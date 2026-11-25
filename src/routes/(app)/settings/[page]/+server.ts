// The pages Settings had: each goes to its line.
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const LINE: Record<string, string> = {
	account: 'password',
	data: 'download',
	day: 'daystart',
	editor: 'newhabits',
	features: 'features',
	integrations: 'keys',
	journal: 'daynote',
	'past-days': 'past',
	reminders: 'reminders',
	stats: 'measures',
	vacation: 'vacation',
	views: 'template'
};

export const GET: RequestHandler = ({ params }) => {
	if (!Object.hasOwn(LINE, params.page)) error(404);
	redirect(307, `/settings#${LINE[params.page]}`);
};
