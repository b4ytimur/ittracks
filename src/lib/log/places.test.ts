import { describe, expect, it } from 'vitest';
import { besides, carryOver, doneBefore, doneLine, fromDraft, goneFrom, placeKey, setsToDo, swapGroups, swapText, usedText, withWaiting, type Pickable } from './places';

const at = (path: string, task: string | null) => ({ path, task: task ? { id: task } : null });
const squat = at('s1', 'squat');
const press = at('s2', 'press');

describe('what is being logged, by place', () => {
	it('tells two Tasks in one place, and one Task in two places, apart', () => {
		const keys = [squat, at('s1', 'lunge'), at('s2', 'squat'), at('s1', null)].map(placeKey);
		expect(new Set(keys).size).toBe(4);
	});

	it('gives a place its own values back when a part was added before it', () => {
		const draft = { [placeKey(squat)]: 'squat values', [placeKey(press)]: 'press values' };
		const now = [squat, at('s1/warm-up#1', 'bar'), press];
		const back = fromDraft(draft, now);
		expect(now.map((p) => back[placeKey(p)])).toEqual(['squat values', undefined, 'press values']);
	});

	it('reads a list from before, and leaves one that no longer fits', () => {
		expect(fromDraft(['a', 'b'], [squat, press])).toEqual({ [placeKey(squat)]: 'a', [placeKey(press)]: 'b' });
		expect(fromDraft(['a', 'b'], [squat])).toEqual({});
	});

	describe('what a log saves besides the places it shows', () => {
		const set = (task: string, path: string, kg: number) => ({ taskId: task, path, values: { kg } });
		const legPress = at('s1', 'legpress');

		it('a set ticked at a place swapped away before it was saved goes with the log, under the Task it was done with', () => {
			const held = { [placeKey(squat)]: [set('squat', 's1', 60), set('squat', 's1', 62.5)], [placeKey(press)]: [set('press', 's2', 40)] };
			expect(besides(held, [legPress, press], [])).toEqual([set('squat', 's1', 60), set('squat', 's1', 62.5)]);
		});
		it('what it held there stands for what the server holds there, which it grew from; the server keeps the rest', () => {
			const held = { [placeKey(squat)]: [set('squat', 's1', 60), set('squat', 's1', 62.5)] };
			const server = [set('squat', 's1', 60), set('lunge', 's1', 20), { taskId: 'squat', path: null, values: { kg: 50 } }];
			expect(besides(held, [legPress, press], server)).toEqual([set('squat', 's1', 60), set('squat', 's1', 62.5), set('lunge', 's1', 20), { taskId: 'squat', path: null, values: { kg: 50 } }]);
		});
		it('a place untouched there since it was saved, or unticked before it went, says so', () => {
			const server = [set('squat', 's1', 60)];
			expect(besides({}, [legPress, press], server)).toEqual(server);
			expect(besides({ [placeKey(squat)]: [] }, [legPress, press], server)).toEqual([]);
		});
		it('a place swapped back is shown again, and saved as it shows', () => {
			expect(besides({ [placeKey(squat)]: [set('squat', 's1', 60)] }, [squat, press], [])).toEqual([]);
		});
		it('swapped back offline, what the server holds for the place shown is saved once, by the place', () => {
			// The server still has Leg press in the Slot, so its Squat sets sit aside until the swap reaches it.
			const server = [set('squat', 's1', 60), set('squat', 's1', 62.5)];
			expect(besides({ [placeKey(squat)]: server, [placeKey(legPress)]: [set('legpress', 's1', 100)] }, [squat, press], server)).toEqual([set('legpress', 's1', 100)]);
			expect(besides({}, [squat, press], server)).toEqual([]);
		});
	});

	describe('a swap made offline, shown before it is sent', () => {
		type It = { path: string; slotId: string; depth: number; kids: number; task: { id: string } | null; saved: Record<string, unknown>[]; previous: Record<string, unknown>[]; targets: Record<string, number> };
		const spot = (path: string, task: string, more: Partial<It> = {}): It => ({ path, slotId: path.split('/')[0], depth: path.split('/').length - 1, kids: 0, task: { id: task }, saved: [], previous: [], targets: {}, ...more });
		const log = [spot('s1', 'legpress', { kids: 1, saved: [{ kg: 100 }], targets: { lp: 120 } }), spot('s1/warm', 'bar'), spot('s2', 'press')];
		const here: Record<string, { task: { id: string }; previous: Record<string, unknown>[] }> = { squat: { task: { id: 'squat' }, previous: [{ kg: 80 }] } };
		const onDevice = (id: string) => here[id];
		const set = (task: string, path: string, kg: number) => ({ taskId: task, path, values: { kg } as Record<string, unknown> });

		it('shows the Task waiting in its Slot, without the old one\'s parts, from its own last time; the Slot keeps its targets', () => {
			const shown = withWaiting(log, { s1: 'squat' }, onDevice, []);
			expect(shown.map(placeKey)).toEqual(['s1|squat', 's2|press']);
			expect(shown[0]).toMatchObject({ kids: 0, previous: [{ kg: 80 }], saved: [], targets: { lp: 120 } });
		});
		it('swapped back to a Task done there before, starts from what the server holds for it', () => {
			const orphans = [set('squat', 's1', 60), set('squat', 's1', 62.5), { taskId: 'squat', path: 's1', values: { _summary: true } }, set('squat', 's2', 1), set('lunge', 's1', 20)];
			expect(withWaiting(log, { s1: 'squat' }, onDevice, orphans)[0].saved).toEqual([{ kg: 60 }, { kg: 62.5 }]);
		});
		it('a Task this page has no fields for, or the one the server shows already, leaves the place as it is', () => {
			expect(withWaiting(log, { s1: 'curl' }, onDevice, [])).toEqual(log);
			expect(withWaiting(log, { s2: 'press' }, () => ({ task: { id: 'press' }, previous: [] }), [])).toEqual(log);
			expect(withWaiting(log, {}, onDevice, [])).toEqual(log);
		});
	});

	describe('done in a Slot before it was swapped', () => {
		const set = (task: string, path: string | null, kg: number) => ({ taskId: task, path, values: { kg } });
		const legPress = at('s1', 'legpress');
		const extra = [
			set('squat', 's1', 60),
			set('squat', 's1', 62.5),
			{ taskId: 'squat', path: 's1', values: { feel: 'easy', _summary: true } },
			{ taskId: 'plank', path: 's1', values: { done: true } },
			// A part removed, and a value from before paths: gone from the habit, not done here.
			set('curl', 's1/gone', 10),
			set('row', null, 30)
		];

		it('is shown in that Slot, by the Task it was done with, counting only its sets', () => {
			expect(doneBefore(extra, legPress)).toEqual([
				{ taskId: 'squat', sets: 2 },
				{ taskId: 'plank', sets: 0 }
			]);
			expect(doneBefore(extra, press)).toEqual([]);
		});
		it('swapped back, the Task done there is the one shown, so it has no line of its own', () => {
			expect(doneBefore([set('squat', 's1', 60), set('legpress', 's1', 100)], squat)).toEqual([{ taskId: 'legpress', sets: 1 }]);
		});
		it('reads in the Task\'s own words', () => {
			expect(doneLine('Bench press', 2, 'set', 'sets')).toBe('Bench press · 2 sets done');
			expect(doneLine('Bench press', 1, 'set', 'sets')).toBe('Bench press · 1 set done');
			expect(doneLine('Rowing', 3, 'interval', 'intervals')).toBe('Rowing · 3 intervals done');
			expect(doneLine('Plank', 0, 'set', 'sets')).toBe('Plank · done');
		});
		it('only what sits at no place shown is gone from the habit', () => {
			expect(goneFrom(extra, [legPress, press])).toEqual([set('curl', 's1/gone', 10), set('row', null, 30)]);
		});
		it('leaves the new Task the sets still to do, at least 1', () => {
			expect(setsToDo(4, 2)).toBe(2);
			expect(setsToDo(4, 5)).toBe(1);
			expect(setsToDo(4, 0)).toBe(4);
		});
	});

	describe("the band's line for a swap", () => {
		it('says which Task is used instead, for today or the past day only', () => {
			expect(swapText('Bench press', 'Incline bench press', 'swap', 'today only')).toBe('Using Incline bench press instead of Bench press, today only.');
			expect(swapText('Bench press', 'Incline bench press', 'swap', 'Tue 18 Nov only')).toBe('Using Incline bench press instead of Bench press, Tue 18 Nov only.');
			expect(swapText(null, 'Plank', 'swap', 'today only')).toBe('Using Plank, today only.');
		});
		it('back to the plan\'s own Task, says so', () => {
			expect(swapText('Incline bench press', 'Bench press', 'back', 'today only')).toBe('Back to Bench press, as planned.');
		});
		it('names what Pick another picked, and what it showed before', () => {
			expect(swapText('Squat', 'Lunge', 'reroll', 'today only')).toBe('Picked Lunge instead of Squat, today only.');
			expect(swapText(null, 'Lunge', 'reroll', 'today only')).toBe('Picked Lunge, today only.');
		});
	});
});

describe('swapping a Task in', () => {
	const f = (id: string, name: string, type = 'number', unit: string | null = null) => ({ id, name, type, unit });
	const bench = [f('bw', 'Weight', 'number', 'kg'), f('br', 'Reps', 'count'), f('bg', 'Grip', 'choice'), f('bt', 'Tempo', 'number', 's')];

	it('starts from the old Task\'s values still to do, where name and unit match', () => {
		const incline = [f('ir', 'reps', 'count'), f('iw', 'Weight', 'number', 'kg'), f('ig', 'Grip', 'choice'), f('it', 'Tempo', 'number', 'min'), f('in', 'Note', 'text')];
		const rows = [
			{ bw: 60, br: 8, bg: 'wide', bt: 3 },
			{ bw: 62.5, br: null, bg: 'wide', bt: 3 }
		];
		expect(carryOver(bench, rows, incline)).toEqual({
			rows: [{ ir: 8, iw: 60 }, { iw: 62.5 }],
			// A Choice's values are its own options, another unit is another number, a field Bench press hasn't stays blank.
			ids: ['ir', 'iw']
		});
	});
	it('with nothing that matches, or nothing left to do, nothing carries over', () => {
		expect(carryOver(bench, [{ bw: 60 }], [f('d', 'Distance', 'number', 'km')])).toEqual({ rows: [{}], ids: [] });
		expect(carryOver(bench, [], bench)).toEqual({ rows: [], ids: [] });
		expect(carryOver(bench, [{ bw: '' }], bench).ids).toEqual([]);
	});

	it('says where a Task was used before, and its first set there when there was one', () => {
		const day = (d: string) => `day ${d}`;
		expect(usedText({ date: '2026-11-12', text: '50 kg × 8' }, day)).toBe('Used here day 2026-11-12 · 50 kg × 8');
		expect(usedText({ date: '2026-11-03', text: '' }, day)).toBe('Used here day 2026-11-03');
	});

	describe('the picker', () => {
		const t = (id: string, tags: string[] = [], date: string | null = null, archived = false, text = ''): Pickable => ({ id, name: id, tags, last: date ? { date, text } : null, archived });
		const library = [
			t('Bench press', ['push', 'chest'], '2026-11-20'),
			t('Arnold press', ['push'], '2026-11-01'),
			t('Close-grip bench press', ['push', 'chest']),
			t('Dumbbell bench press', ['push', 'chest'], '2026-11-10'),
			t('Incline bench press', ['push', 'chest'], '2026-11-12'),
			t('Old press', ['push'], null, true),
			t('Squat', ['legs'], '2026-11-19', false, '100 kg × 5'),
			t('Dips', ['push']),
			t('Push-up', ['push']),
			t('Pec fly', ['chest']),
			t('Plank')
		];
		const base = { library, used: [{ taskId: 'Incline bench press', date: '2026-11-12', text: '50 kg × 8' }], like: { id: 'Bench press', name: 'Bench press' }, current: 'Bench press', query: '', day: (d: string) => d.slice(5), away: () => false };
		const names = (gs: ReturnType<typeof swapGroups>) => gs.map((g) => [g.label, g.rows.map((r) => r.name)]);

		it('used here first, then up to 5 alike (most Tags shared first), then the rest A–Z; the one in use and archived ones never', () => {
			expect(names(swapGroups(base))).toEqual([
				['Used here before', ['Incline bench press']],
				['Like Bench press', ['Close-grip bench press', 'Dumbbell bench press', 'Arnold press', 'Dips', 'Pec fly']],
				['In the Library', ['Plank', 'Push-up', 'Squat']]
			]);
			const rows = swapGroups(base).flatMap((g) => g.rows);
			expect(rows.find((r) => r.id === 'Incline bench press')?.meta).toBe('Used here 11-12 · 50 kg × 8');
			// Last time's first set, or only the day when nothing was done in sets.
			expect(rows.find((r) => r.id === 'Squat')?.meta).toBe('Last 100 kg × 5');
			expect(rows.find((r) => r.id === 'Arnold press')?.meta).toBe('Last 11-01');
			expect(rows.find((r) => r.id === 'Plank')?.meta).toBe('Never done');
		});
		it('swapped already, the plan\'s Task is offered again and the one in use is not', () => {
			const rows = swapGroups({ ...base, used: [], current: 'Incline bench press' }).flatMap((g) => g.rows.map((r) => r.id));
			expect(rows).not.toContain('Incline bench press');
			expect(rows).toContain('Bench press');
		});
		it('a search keeps the names that hold it, in their groups, and drops empty groups', () => {
			expect(names(swapGroups({ ...base, query: ' PRESS ' }))).toEqual([
				['Used here before', ['Incline bench press']],
				['Like Bench press', ['Close-grip bench press', 'Dumbbell bench press', 'Arnold press']]
			]);
			expect(swapGroups({ ...base, query: 'nothing like it' })).toEqual([]);
		});
		it('with no Task to be like, or none alike, there is no such group', () => {
			expect(names(swapGroups({ ...base, like: null, used: [] })).map(([l]) => l)).toEqual(['In the Library']);
		});
		it('offline, a Task whose fields are not on this device needs a connection', () => {
			const rows = swapGroups({ ...base, away: (id) => id !== 'Incline bench press' }).flatMap((g) => g.rows);
			expect(rows.find((r) => r.id === 'Incline bench press')).toMatchObject({ disabled: false });
			expect(rows.find((r) => r.id === 'Squat')).toEqual({ id: 'Squat', name: 'Squat', meta: 'Needs a connection', disabled: true });
		});
	});
});
