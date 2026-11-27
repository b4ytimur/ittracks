import { describe, expect, it } from 'vitest';
import lines from '$lib/settings/lines.ts?raw';
import { GET } from './+server';

/** Where an old Settings page sends you. */
function target(page: string): { status: number; location?: string } {
	try {
		GET({ params: { page } } as Parameters<typeof GET>[0]);
	} catch (e) {
		return e as { status: number; location?: string };
	}
	throw new Error('no redirect');
}

describe('the pages Settings had', () => {
	it('each goes to a line that exists, or to Set where they act', () => {
		for (const page of ['account', 'data', 'day', 'editor', 'features', 'integrations', 'journal', 'past-days', 'reminders', 'stats', 'vacation']) {
			const { status, location } = target(page);
			expect(status).toBe(307);
			expect(location).toMatch(/^\/settings#/);
			expect(lines).toContain(`id: '${location!.slice('/settings#'.length)}'`);
		}
		// View templates moved to Today; their way there is listed under Set where they act.
		expect(target('views')).toMatchObject({ status: 307, location: '/settings?g=elsewhere' });
		expect(target('nope').status).toBe(404);
	});
});
