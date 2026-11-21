// Talking to /api/stats from a page.
export async function statsOp<T = { ok: true; id?: string; warnings?: string[] }>(body: Record<string, unknown>): Promise<T> {
	const res = await fetch('/api/stats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	if (!res.ok) {
		const j = await res.json().catch(() => null);
		throw new Error(j?.message ?? 'That change could not be saved');
	}
	return res.json();
}
