// One thing to say on the next page: what a quick link did. A short-lived cookie, read once.
import type { Cookies } from '@sveltejs/kit';
import { z } from 'zod';

const NAME = 'ittracks_flash';
const flash = z.object({
	kind: z.enum(['did', 'already', 'notDue', 'error']),
	text: z.string().max(500),
	habit: z.string().max(64).optional(),
	occurrence: z.string().max(64).optional(),
	/** Its Undo also takes out what it logged. */
	clear: z.boolean().optional()
});
export type Flash = z.infer<typeof flash>;

export const setFlash = (cookies: Cookies, f: Flash, secure: boolean) => cookies.set(NAME, JSON.stringify(f), { path: '/', maxAge: 60, httpOnly: true, sameSite: 'lax', secure });
export function takeFlash(cookies: Cookies): Flash | null {
	const raw = cookies.get(NAME);
	if (!raw) return null;
	cookies.delete(NAME, { path: '/' });
	try {
		const p = flash.safeParse(JSON.parse(raw));
		return p.success ? p.data : null;
	} catch {
		return null;
	}
}
