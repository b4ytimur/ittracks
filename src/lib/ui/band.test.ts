import { afterEach, describe, expect, it } from 'vitest';
import { refocus } from './Band.svelte';
import { band, showToast } from '$lib/toast.svelte';

// A page whose focus moves to whatever takes it; `takes: false` is a place that is inert or hidden.
const page = () => {
	const doc = { body: {} as unknown, activeElement: null as unknown };
	doc.activeElement = doc.body;
	const el = (isConnected = true, takes = true) => {
		const it = { isConnected, focus: () => void (takes && (doc.activeElement = it)) };
		return it;
	};
	return { doc, el };
};

describe('refocus: where focus goes once the pressed Undo went with its entry', () => {
	it('back where the change was made', () => {
		const { doc, el } = page();
		const from = el();
		refocus(doc, from, el());
		expect(doc.activeElement).toBe(from);
	});
	it('to the band when that place is gone, takes no focus, or was never there', () => {
		type El = ReturnType<typeof page>['el'];
		for (const place of [(el: El) => el(false), (el: El) => el(true, false), () => null]) {
			const { doc, el } = page();
			const shelf = el();
			refocus(doc, place(el), shelf);
			expect(doc.activeElement).toBe(shelf);
		}
	});
	it('focus that is somewhere already stays there', () => {
		const { doc, el } = page();
		const elsewhere = el();
		doc.activeElement = elsewhere;
		refocus(doc, el(), el());
		expect(doc.activeElement).toBe(elsewhere);
	});
});

describe('an entry keeps what had focus when it was posted', () => {
	const doc = globalThis.document;
	afterEach(() => {
		(globalThis as { document?: unknown }).document = doc;
		band.entries = [];
	});
	it('the control that made the change, and nothing while focus was on the page', () => {
		const body = {};
		const grip = {};
		(globalThis as { document?: unknown }).document = { body, activeElement: grip };
		showToast('Moved Deep work to 2 of 2.', () => true);
		expect(band.entries[0].from).toBe(grip);
		(globalThis as { document?: unknown }).document = { body, activeElement: body };
		showToast('Archived Gym.', () => true);
		expect(band.entries[0].from).toBeNull();
	});
	it('no page (the server): nothing', () => {
		(globalThis as { document?: unknown }).document = undefined;
		showToast('Saved.');
		expect(band.entries[0].from).toBeNull();
	});
});
