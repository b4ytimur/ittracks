// One short message at a time at the bottom of the screen, with an optional Undo.
// Quick actions happen at once and offer Undo, instead of asking "Are you sure?".

export interface Toast {
	id: number;
	text: string;
	undo?: () => void | Promise<void>;
}

const UNDO_MS = 5000;
let next = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

export const toast = $state<{ current: Toast | null }>({ current: null });

export function showToast(text: string, undo?: Toast['undo'], ms = undo ? UNDO_MS : 3000) {
	clearTimeout(timer);
	const t = { id: next++, text, undo };
	toast.current = t;
	timer = setTimeout(() => {
		if (toast.current?.id === t.id) toast.current = null;
	}, ms);
}

export function dismissToast() {
	clearTimeout(timer);
	toast.current = null;
}

/** Post a form action from code, as SvelteKit's enhance would. */
export async function postAction(action: string, fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return fetch(action, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
}
