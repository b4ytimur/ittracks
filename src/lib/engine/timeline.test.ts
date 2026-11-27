import { expect, it } from 'vitest';
import { timeline, type Timed } from './stack';

const at = (id: string, clock: string | null, kids?: Timed[]): Timed => ({ id, clock, label: clock, kids });
const day = [
	at('supplements', '09:00'), // a routine: no kids passed, one slot
	at('back', null, [at('back-am', '08:30'), at('back-pm', '20:30')]),
	at('physio', null, [at('physio-am', '08:00'), at('physio-pm', '20:00')]),
	at('spanish', null),
	at('vitamins', null, [at('a', null), at('b', '07:00')]) // a kid with no time of its own goes where the group goes
];
const ids = (slots: { key: string; items: Timed[] }[]) => slots.map((s) => `${s.key} ${s.items.map((i) => i.id).join(',')}`);

it('splits the day at now, any time between, and a group stands at each of its times', () => {
	const t = timeline(day, '12:30');
	expect(ids(t.past)).toEqual(['07:00 vitamins', '08:00 physio', '08:30 back', '09:00 supplements']);
	expect(t.anyTime?.items.map((i) => i.id)).toEqual(['spanish', 'vitamins']);
	expect(ids(t.ahead)).toEqual(['20:00 physio', '20:30 back']);
	expect([...t.past[2].only.get('back')!]).toEqual(['back-am']);
	expect([...t.ahead[1].only.get('back')!]).toEqual(['back-pm']);
	expect([...t.anyTime!.only.get('vitamins')!]).toEqual(['a']);
});

it('keeps a group whole when its habits share one time, and orders by the day start', () => {
	const t = timeline([at('late', '01:00'), at('g', null, [at('x', '23:00'), at('y', null)]), at('h', null, [at('z', '22:00')])], '23:30', '04:00');
	expect(ids(t.past)).toEqual(['22:00 h', '23:00 g']);
	expect(t.past[0].only.size).toBe(0);
	expect(ids(t.ahead)).toEqual(['01:00 late']);
	expect(t.anyTime?.items.map((i) => i.id)).toEqual(['g']);
});
