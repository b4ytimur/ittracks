// The rest clock: one per person, read from the moment it ends, so it survives a lock, a reload and
// another page. The band shows it for as long as it runs.
import { browser } from '$app/environment';

export interface Rest {
	end: number;
	/** What comes next: "set 3 of Barbell row". */
	label: string;
	href: string;
}

const KEY = 'ittracks-rest';
/** A rest nobody came back to stops showing. */
const FORGET_MS = 15 * 60_000;

function stored(): Rest | null {
	if (!browser) return null;
	try {
		const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Rest | null;
		return r && Date.now() - r.end < FORGET_MS ? r : null;
	} catch {
		return null;
	}
}
export const rest = $state<{ now: Rest | null }>({ now: stored() });

function keep(r: Rest | null) {
	rest.now = r;
	try {
		if (r) localStorage.setItem(KEY, JSON.stringify(r));
		else localStorage.removeItem(KEY);
	} catch {
		/* storage blocked: it runs until the page closes */
	}
}
export const startRest = (seconds: number, label: string, href: string) => keep({ end: Date.now() + seconds * 1000, label, href });
export const moreRest = (seconds: number) => rest.now && keep({ ...rest.now, end: Math.max(Date.now(), rest.now.end) + seconds * 1000 });
export const endRest = () => keep(null);
export const forgotten = (r: Rest, at: number) => at - r.end > FORGET_MS;

/** "Rest 1:12", and after it "Rest over +0:20". */
export function restText(end: number, at: number): string {
	const s = Math.ceil((end - at) / 1000);
	const t = Math.abs(s);
	const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
	return s > 0 ? `Rest ${clock}` : `Rest over${t ? ` +${clock}` : ''}`;
}
