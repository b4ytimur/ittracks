// The band's recent changes, newest first, each with its own Undo. Kept pure so it can be tested.

export interface Entry {
	id: number;
	text: string;
	/** Takes it back. False or a sentence says it couldn't. */
	undo?: () => unknown;
	/** The change shows its own way back where it is, so the band offers no Undo for it yet. */
	held?: boolean;
	/** A save that failed, and how to send it again. */
	error?: boolean;
	retry?: () => unknown;
}

const CAP = 10;

export const pushEntry = (entries: Entry[], e: Entry): Entry[] => [e, ...entries].slice(0, CAP);
export const dropEntry = (entries: Entry[], id: number): Entry[] => entries.filter((e) => e.id !== id);
export const setHeld = (entries: Entry[], id: number, held: boolean): Entry[] => entries.map((e) => (e.id === id ? { ...e, held } : e));
export const canUndo = (e: Entry): boolean => !!e.undo && !e.held;
