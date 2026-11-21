// Browser side of views: send changes to /api/views.
import type { Page, ViewSettings, ViewState } from './views';

export async function viewOp(body: Record<string, unknown>): Promise<{ views: ViewSettings; id?: string; previous?: ViewSettings } | null> {
	try {
		const res = await fetch('/api/views', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		return res.ok ? await res.json() : null;
	} catch {
		// Offline: the view still works on this screen; it just isn't remembered.
		return null;
	}
}

const timers = new Map<Page, ReturnType<typeof setTimeout>>();

/** Remember a page's filter and sort, a moment after the last change. */
export function rememberLast(page: Page, state: ViewState) {
	clearTimeout(timers.get(page));
	const snapshot = JSON.parse(JSON.stringify(state));
	timers.set(page, setTimeout(() => viewOp({ op: 'last', page, state: snapshot }), 600));
}
