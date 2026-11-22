// Who is acting: the app itself, a key, a quick-log link, the MCP server or a reminder button.
// Every action and every event carries one, so a key can be limited and the event log can
// say where a log came from.

/** What a key may do. The app itself may do everything. */
export const SCOPES = {
	read: 'Read habits, logs and stats (values only, no notes)',
	log: 'Log, skip and undo, and add slips',
	notes: 'Read and write notes and the journal',
	export: 'Download a full export'
} as const;
export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

/** Where a change came from, as the event log records it. */
export type Source = 'app' | 'key' | 'link' | 'mcp' | 'reminder' | 'import';

export interface Actor {
	accountId: string;
	source: Source;
	/** The key used, if any. */
	tokenId: string | null;
	scopes: ReadonlySet<Scope>;
	/** Only these habits; null means every habit. */
	habitIds: ReadonlySet<string> | null;
	/** The browser's time zone, when known (the app sends it as a cookie). */
	tz?: string;
}

/** The signed-in person using the app: every scope, every habit. */
export function appActor(accountId: string, tz?: string, source: Source = 'app'): Actor {
	return { accountId, source, tokenId: null, scopes: new Set(ALL_SCOPES), habitIds: null, tz };
}

export const canSeeHabit = (a: Actor, habitId: string) => !a.habitIds || a.habitIds.has(habitId);

/** A failure an action reports to its caller: a code a program can check and a sentence a person can read. */
export class ActionError extends Error {
	constructor(
		public code: 'unauthorized' | 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'not_due',
		message: string,
		public details?: unknown
	) {
		super(message);
	}
	get status() {
		return { unauthorized: 401, forbidden: 403, not_found: 404, invalid: 400, conflict: 409, not_due: 409 }[this.code];
	}
}

export function requireScope(a: Actor, scope: Scope) {
	if (!a.scopes.has(scope)) throw new ActionError('forbidden', `This key can't ${SCOPES[scope].toLowerCase()}. Add the “${scope}” access to it in Settings → Integrations.`);
}
