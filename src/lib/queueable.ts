// A form enhancement that keeps working offline: with no connection the action waits in
// the outbox and the page carries on as if it went through.
import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
import { enqueue, isOffline } from './outbox.svelte';

export function queueable(
	label: string,
	opts: { onQueued?: () => void; after?: (result: ActionResult) => void; reset?: boolean } = {}
): SubmitFunction {
	return ({ action, formData, cancel }) => {
		const fields = () => [...formData.entries()].map(([k, v]) => [k, String(v)] as [string, string]);
		const url = action.pathname + action.search;
		if (!navigator.onLine) {
			cancel();
			enqueue(url, fields(), label);
			opts.onQueued?.();
			return;
		}
		return async ({ result, update }) => {
			if (result.type === 'error' && isOffline(result.error)) {
				enqueue(url, fields(), label);
				opts.onQueued?.();
				return;
			}
			await update({ reset: opts.reset ?? false });
			opts.after?.(result);
		};
	};
}
