// A habit's Stats tab: the number Today shows from one of its tiles, the title line's ⋯, and the line a new card posts
// (its New card works as on a board, so CardGrid posts that line on both).
import type { StatCard } from './model';

/** Show a tile on Today, or stop showing the one it shows: what to send, what the band says, and the Undo that puts back the one before. */
export function headlineChange(habit: { id: string; name: string }, now: StatCard | null, card: StatCard, title: string) {
	const off = now?.id === card.id;
	return {
		change: { op: 'headline', habit: habit.id, card: off ? null : card },
		said: off ? 'Today shows the usual headline again' : `Today shows “${title}” for ${habit.name}`,
		undo: { op: 'headline', habit: habit.id, card: now }
	};
}

/** The title line's ⋯: Back to the automatic cards, only while the tab has cards of its own (with none, it would do nothing). */
export const tabMore = (customized: boolean, reset: () => void) => (customized ? [{ label: 'Back to the automatic cards', onselect: reset }] : []);

/** A card added from New card: the band says so (or the server's warning instead), and its Undo takes the card off again. */
export const cardAdded = (where: { board: string } | { habit: string }, id: string, title: string, warnings: string[] = []) => ({
	said: warnings[0] ?? `Added “${title}”`,
	undo: { op: 'card.delete', where, id }
});
