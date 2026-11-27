// The pages Settings had: each goes to its line. Views left Settings: their way there is under Set where they act.
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const LINE: Record<string, string> = {
	account: '#password',
	data: '#download',
	day: '#daystart',
	editor: '#newhabits',
	features: '#features',
	integrations: '#keys',
	journal: '#daynote',
	'past-days': '#past',
	reminders: '#reminders',
	stats: '#measures',
	vacation: '#vacation',
	views: '?g=elsewhere'
};

export const GET: RequestHandler = ({ params }) => {
	if (!Object.hasOwn(LINE, params.page)) error(404);
	redirect(307, `/settings${LINE[params.page]}`);
};
