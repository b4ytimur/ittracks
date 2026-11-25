// Browser side of views: send changes to /api/views.
import { showError } from './toast.svelte';
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

/** Save a layout change. When that fails, what it did is put back and the band says so. */
export async function saveLayout(body: Record<string, unknown>, rollback: () => void, again?: () => void) {
	const r = await viewOp(body);
	if (!r) {
		rollback();
		showError('Not saved. It is back as it was.', again);
	}
	return r;
}

const timers = new Map<string, { at: ReturnType<typeof setTimeout>; send: () => Promise<unknown> }>();

/**
 * Save a change to a view's filter, sort and grouping, a moment after the last change: the view named,
 * else the one the page is on. Each view waits on its own, so switching views never drops a change.
 */
export function saveView(page: Page, state: ViewState, view?: string) {
	const key = `${page}:${view ?? ''}`;
	clearTimeout(timers.get(key)?.at);
	const snapshot = JSON.parse(JSON.stringify(state));
	const send = () => (timers.delete(key), viewOp({ op: 'update', page, view, state: snapshot }));
	timers.set(key, { at: setTimeout(send, 600), send });
}

/** Send the changes still waiting now, before something that replaces the views. */
export function flushViews() {
	const waiting = [...timers.values()];
	for (const t of waiting) clearTimeout(t.at);
	return Promise.all(waiting.map((t) => t.send()));
}
