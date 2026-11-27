import { describe, expect, it } from 'vitest';
import { aimFor, aimText, besides, carryOver, doneBefore, doneLine, fromDraft, goneFrom, insteadLine, keptText, loggedAt, noRows, placeKey, setsToDo, startedLog, swapGroups, swapText, usedText, waitingText, withWaiting, type Pickable } from './places';

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
		// A place, with how many parts its Task holds.
		const spot = (path: string, task: string, kids = 0) => ({ ...at(path, task), kids });
		const legPress = spot('s1', 'legpress');
		const presses = spot('s2', 'press');
		const extra = [
			set('squat', 's1', 60),
			set('squat', 's1', 62.5),
			{ taskId: 'squat', path: 's1', values: { feel: 'easy', _summary: true } },
			{ taskId: 'plank', path: 's1', values: { done: true } },
			// A value from before paths: gone from the habit, not done here.
			set('row', null, 30)
		];

		it('is shown in that Slot, by the Task it was done with, counting only its sets', () => {
			expect(doneBefore(extra, legPress)).toEqual([
				{ taskId: 'squat', sets: 2 },
				{ taskId: 'plank', sets: 0 }
			]);
			expect(doneBefore(extra, presses)).toEqual([]);
		});
		it('swapped back, the Task done there is the one shown, so it has no line of its own', () => {
			expect(doneBefore([set('squat', 's1', 60), set('legpress', 's1', 100)], spot('s1', 'squat'))).toEqual([{ taskId: 'legpress', sets: 1 }]);
		});
		// Upper circuit (Push-up, Row) swapped for Leg press after round 1: its parts sit under the Slot, deeper.
		const circuit = [{ taskId: 'pushup', path: 's1#1/p1', values: { done: true } }, set('row', 's1#1/p2', 40), set('row', 's1#2/p2', 40), set('legpress', 's1/p9', 90)];
		it("a Task with parts swapped away: each part's Task gets a line in the Slot, also the Task shown now done as a part", () => {
			expect(doneBefore(circuit, legPress)).toEqual([
				{ taskId: 'pushup', sets: 0 },
				{ taskId: 'row', sets: 2 },
				{ taskId: 'legpress', sets: 1 }
			]);
			expect(goneFrom(circuit, [legPress, presses])).toEqual([]);
			// Only a Slot's own Task: a part with nothing inside is no Slot.
			expect(doneBefore(circuit, spot('s1/p3', 'curl'))).toEqual([]);
		});
		it('under a Task with parts still shown, a part removed from it is gone from the habit, not done before', () => {
			const shown = [spot('s1', 'upper', 1), spot('s1#1/p2', 'row'), presses];
			expect(doneBefore(circuit, shown[0])).toEqual([]);
			expect(goneFrom(circuit, shown)).toEqual([circuit[0], circuit[2], circuit[3]]);
		});
		it('reads in the Task\'s own words', () => {
			expect(doneLine('Bench press', 2, 'set', 'sets')).toBe('Bench press · 2 sets done');
			expect(doneLine('Bench press', 1, 'set', 'sets')).toBe('Bench press · 1 set done');
			expect(doneLine('Rowing', 3, 'interval', 'intervals')).toBe('Rowing · 3 intervals done');
			expect(doneLine('Plank', 0, 'set', 'sets')).toBe('Plank · done');
		});
		it('only what sits at no place shown is gone from the habit', () => {
			expect(goneFrom(extra, [legPress, presses])).toEqual([set('row', null, 30)]);
			expect(goneFrom([set('curl', 's3/gone', 10)], [legPress, presses])).toEqual([set('curl', 's3/gone', 10)]);
		});
		it('a log is started by what a place saved or ticked, or by what it holds besides them, done before a swap too', () => {
			const none = { sets: [{ done: false }] };
			expect(startedLog([], [{ saved: [] }, { saved: [] }], [none, undefined])).toBe(false);
			expect(startedLog([set('squat', 's1', 60)], [{ saved: [] }], [none])).toBe(true);
			expect(startedLog([], [{ saved: [] }, { saved: [{ kg: 60 }] }], [none, none])).toBe(true);
			expect(startedLog([], [{ saved: [] }], [{ sets: [{ done: false }, { done: true }] }])).toBe(true);
			expect(startedLog([], [{ saved: [] }], [{ sets: [], tick: true }])).toBe(true);
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
		it('waiting to be sent, says it syncs later, and only says it is in use when the place can show it', () => {
			expect(waitingText('Bench press', 'Incline bench press', 'swap', 'today only', true)).toBe("Using Incline bench press instead of Bench press, today only. It will sync when you're back online.");
			expect(waitingText('Bench press', 'Upper circuit', 'swap', 'today only', false)).toBe("Upper circuit will swap in when you're back online.");
			expect(waitingText('Squat', undefined, 'reroll', 'today only', false)).toBe("Picking another Task, today only. It will sync when you're back online.");
		});
	});

	it("a past log names the plan's Task a swapped-in one was done instead of, and only then", () => {
		expect(insteadLine('Incline bench press', 'Bench press')).toBe('Incline bench press · instead of Bench press');
		expect(insteadLine('Incline bench press', null)).toBe('Incline bench press');
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

	describe('kept in the plan', () => {
		const incline = [f('iw', 'Weight', 'number', 'kg'), f('ir', 'Reps', 'count'), f('it', 'Tempo', 'number', 'min'), f('ig', 'Grip', 'choice')];
		const planned = { bw: 60, br: 8, bt: 3, bg: 1 };
		it('aims only in the fields the old Task had a target in, matched by name and unit', () => {
			const today = [{ iw: 50, ir: 8, it: 2, ig: 'wide' }];
			expect(aimFor(bench, { bw: 60 }, incline, today, [])).toEqual({ iw: 50 });
			// Another unit is another number, and a Choice's values are its own options.
			expect(aimFor(bench, planned, incline, today, [])).toEqual({ iw: 50, ir: 8 });
			// The old Task had no targets: none.
			expect(aimFor(bench, {}, incline, today, [])).toEqual({});
		});
		it("takes what most of today's sets used; on a tie, the last one's", () => {
			const rows = (...kg: number[]) => kg.map((iw) => ({ iw, ir: 8 }));
			expect(aimFor(bench, planned, incline, rows(50, 52.5, 52.5), [])).toEqual({ iw: 52.5, ir: 8 });
			expect(aimFor(bench, planned, incline, rows(52.5, 50, 50, 52.5), [])).toEqual({ iw: 52.5, ir: 8 });
			expect(aimFor(bench, planned, incline, rows(50, 50, 55, 55, 60), [])).toEqual({ iw: 55, ir: 8 });
		});
		it('with nothing done today, its last time; with no last time, no target', () => {
			const last = [{ iw: 47.5, ir: 10 }, { iw: 47.5, ir: 9 }, { _summary: true, note: 'ok' }];
			expect(aimFor(bench, planned, incline, [], last)).toEqual({ iw: 47.5, ir: 9 });
			// A field left empty today falls back on its own; a set with nothing in it isn't a number.
			expect(aimFor(bench, planned, incline, [{ iw: 50, ir: null }, { done: true }], last)).toEqual({ iw: 50, ir: 9 });
			expect(aimFor(bench, planned, incline, [], [])).toEqual({});
		});
		it("aims from what the Task did in that Slot today, in its place and before a swap took it away; never another Task's or another Slot's", () => {
			const shown = [{ taskId: 'incline', path: 's1', values: { iw: 55 } }, { taskId: 'press', path: 's2', values: { iw: 40 } }];
			const before = [{ taskId: 'incline', path: 's1', values: { iw: 50 } }, { taskId: 'bench', path: 's1', values: { bw: 60 } }, { taskId: 'incline', path: 's3', values: { iw: 30 } }];
			expect(loggedAt([...shown, ...before], 'incline', 's1')).toEqual([{ iw: 55 }, { iw: 50 }]);
			expect(loggedAt(shown, 'dumbbell', 's1')).toEqual([]);
		});
		it("aims once-per-log fields too, from the place's own values", () => {
			const time = [f('d', 'Time', 'duration')];
			expect(aimFor(time, { d: 20 }, time, [{ d: 25, _summary: true }], [{ d: 15, _summary: true }])).toEqual({ d: 25 });
		});
		it('says the aim: the sets, then a row of the targets, then the once-per-log ones', () => {
			const field = (id: string, name: string, unit: string | null, repeats: boolean, times = false) => ({ id, name, type: 'number', unit, repeats, times, prefill: 'last', choices: null });
			const fields = [field('w', 'Weight', 'kg', true), field('r', 'Reps', null, true, true), field('d', 'Time', 'min', false)];
			expect(aimText(4, fields, { w: 50, r: 8 })).toBe('4 × 50 kg × 8');
			expect(aimText(null, fields, { w: 50 })).toBe('50 kg');
			expect(aimText(3, fields, { w: 50, d: 20 })).toBe('3 × 50 kg · 20 min');
			expect(aimText(4, fields, { d: 20 })).toBe('20 min');
			expect(aimText(4, fields, {})).toBe('');
		});
		it("names the Variant in the band's line, and the aim when there is one", () => {
			expect(keptText('Bench press', 'Incline bench press', 'Push day A', '4 × 50 kg × 8')).toBe('Replaced Bench press with Incline bench press in Push day A, from now on, aiming for 4 × 50 kg × 8.');
			expect(keptText('Bench press', 'Plank', 'Push day A', '')).toBe('Replaced Bench press with Plank in Push day A, from now on.');
		});
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
		it('with no rows it says why: nothing matches what was typed, or nothing else is in the Library', () => {
			expect(noRows('')).toBe('Nothing else in the Library yet.');
			expect(noRows('  ')).toBe('Nothing else in the Library yet.');
			expect(noRows('dumb')).toBe('Nothing in the Library is called that.');
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
