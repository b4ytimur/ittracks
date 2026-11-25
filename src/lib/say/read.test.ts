import { describe, expect, it } from 'vitest';
import { STARTER } from '../units';
import { readHabit, sayWords } from './read';

// What is said, and how it reads back.
const EN: [string, string][] = [
	['read 10 pages', 'Read · 10 pages · every day · any time'],
	['practise scales 10 minutes', 'Practise scales · 10 min · every day · any time'],
	['3 ducks every day', 'Ducks · 3 ducks · every day · any time'],
	['drink 8 glasses of water', 'Drink water · 8 glasses · every day · any time'],
	['drink 2 l of water daily', 'Drink water · 2 l · every day · any time'],
	['run 5 km twice a week', 'Run · 5 km · 2 times a week · any time'],
	['run 5km three times a week', 'Run · 5 km · 3 times a week · any time'],
	['gym 3x a week', 'Gym · just done · 3 times a week · any time'],
	['gym 4 times per week in the evening', 'Gym · just done · 4 times a week · in the evening'],
	['meditate every morning for 15 min', 'Meditate · 15 min · every day · in the morning'],
	['meditate', 'Meditate · just done · every day · any time'],
	['journal before bed', 'Journal · just done · every day · at night'],
	['take vitamins at 8:30', 'Take vitamins · just done · every day · at 08:30'],
	['stretch at 7am', 'Stretch · just done · every day · at 07:00'],
	['call mum on Sundays', 'Call mum · just done · on Sunday · any time'],
	['call mum every Sunday at 6 pm', 'Call mum · just done · on Sunday · at 18:00'],
	['piano on Mon, Wed and Fri', 'Piano · just done · on Monday, Wednesday and Friday · any time'],
	['piano monday/thursday 30 minutes', 'Piano · 30 min · on Monday and Thursday · any time'],
	['spanish on weekdays', 'Spanish · just done · on weekdays · any time'],
	['long walk on weekends 2 hours', 'Long walk · 2 h · on weekends · any time'],
	['water the plants every 3 days', 'Water the plants · just done · every 3 days · any time'],
	['shave every other day', 'Shave · just done · every other day · any time'],
	['clean the fridge monthly', 'Clean the fridge · just done · once a month · any time'],
	['budget once a month', 'Budget · just done · once a month · any time'],
	['weekly review', 'Review · just done · once a week · any time'],
	['deep work 2.5 hours', 'Deep work · 2.5 h · every day · any time'],
	['push ups 20', 'Push ups · 20 · every day · any time'],
	['20 push ups', 'Push ups · 20 · every day · any time'],
	['do 20 push ups in the morning', 'Do push ups · 20 · every day · in the morning'],
	['write three sentences', 'Write · 3 sentences · every day · any time'],
	['log body weight', 'Body weight · just done · every day · any time'],
	['I want to learn guitar', 'Learn guitar · just done · every day · any time'],
	['stop smoking', 'Smoking · to stop'],
	['quit sugar', 'Sugar · to stop'],
	['no social media', 'Social media · to stop'],
	["don't bite my nails", 'Bite my nails · to stop'],
	['no phone in the evening', 'Phone · to stop'],
	['floss after dinner', 'Floss · just done · every day · in the evening'],
	['duolingo 2 lessons after lunch', 'Duolingo · 2 lessons · every day · in the afternoon'],
	['walk 10000 steps', 'Walk · 10000 steps · every day · any time'],
	['bench press 60 kg', 'Bench press · 60 kg · every day · any time'],
	['sleep 8 hours at night', 'Sleep · 8 h · every day · at night'],
	['1984', '1984 · 1984 · every day · any time'],
	['morning pages', 'Morning pages · just done · every day · any time'],
	['morning block every day at 7', 'Morning block · just done · every day · at 07:00'],
	['evening walk 20 minutes in the evening', 'Evening walk · 20 min · every day · in the evening'],
	['run mornings', 'Run · just done · every day · in the morning'],
	['the sun salutation', 'The sun salutation · just done · every day · any time'],
	['', ' · just done · every day · any time']
];
const DE: [string, string][] = [
	['10 Seiten lesen', 'Lesen · 10 Seiten · every day · any time'],
	['lesen 10 Seiten jeden Tag', 'Lesen · 10 Seiten · every day · any time'],
	['drei Enten täglich', 'Enten · 3 Enten · every day · any time'],
	['8 Gläser Wasser trinken', 'Wasser trinken · 8 Gläser · every day · any time'],
	['Tonleitern üben 10 min', 'Tonleitern üben · 10 min · every day · any time'],
	['5 km laufen zweimal die Woche', 'Laufen · 5 km · 2 times a week · any time'],
	['Laufen 5km 3 mal pro Woche', 'Laufen · 5 km · 3 times a week · any time'],
	['Fitnessstudio 4x pro Woche', 'Fitnessstudio · just done · 4 times a week · any time'],
	['meditieren morgens 15 min', 'Meditieren · 15 min · every day · in the morning'],
	['meditieren am Morgen', 'Meditieren · just done · every day · in the morning'],
	['Tagebuch abends', 'Tagebuch · just done · every day · in the evening'],
	['Tagebuch vor dem Schlafen', 'Tagebuch · just done · every day · at night'],
	['Vitamine um 8 Uhr', 'Vitamine · just done · every day · at 08:00'],
	['Vitamine um 8:30', 'Vitamine · just done · every day · at 08:30'],
	['Mama anrufen sonntags', 'Mama anrufen · just done · on Sunday · any time'],
	['Mama anrufen am Sonntag', 'Mama anrufen · just done · on Sunday · any time'],
	['Klavier Mo, Mi und Fr', 'Klavier · just done · on Monday, Wednesday and Friday · any time'],
	['Klavier montags und donnerstags 30 min', 'Klavier · 30 min · on Monday and Thursday · any time'],
	['Spanisch werktags', 'Spanisch · just done · on weekdays · any time'],
	['Spaziergang am Wochenende 2 h', 'Spaziergang · 2 h · on weekends · any time'],
	['Pflanzen gießen alle 3 Tage', 'Pflanzen gießen · just done · every 3 days · any time'],
	['rasieren jeden zweiten Tag', 'Rasieren · just done · every other day · any time'],
	['Haushaltsbuch monatlich', 'Haushaltsbuch · just done · once a month · any time'],
	['Wochenrückblick einmal die Woche', 'Wochenrückblick · just done · once a week · any time'],
	['2,5 h konzentriert arbeiten', 'Konzentriert arbeiten · 2.5 h · every day · any time'],
	['aufhören mit Rauchen', 'Rauchen · to stop'],
	['Rauchen aufhören', 'Rauchen · to stop'],
	['kein Zucker', 'Zucker · to stop'],
	['keine sozialen Medien', 'Sozialen Medien · to stop'],
	['nicht mehr naschen', 'Naschen · to stop'],
	['Ich möchte Gitarre lernen', 'Gitarre lernen · just done · every day · any time'],
	['Liegestütze 20', 'Liegestütze · 20 · every day · any time'],
	['Zahnseide nach dem Essen', 'Zahnseide · just done · every day · in the evening'],
	['10000 Schritte gehen', 'Gehen · 10000 Schritte · every day · any time'],
	['Kreuzheben 60 kg dreimal im Monat', 'Kreuzheben · 60 kg · 3 times a month · any time'],
	['spazieren nachmittags', 'Spazieren · just done · every day · in the afternoon'],
	['So wird es gemacht', 'So wird es gemacht · just done · every day · any time'],
	['Do it yourself', 'Do it yourself · just done · every day · any time']
];

describe('what is said', () => {
	it.each(EN)('%s', (text, said) => expect(sayWords(readHabit(text, STARTER))).toBe(said));
	it.each(DE)('%s', (text, said) => expect(sayWords(readHabit(text, STARTER))).toBe(said));

	it('keeps every word that was typed, somewhere', () => {
		const filler = /^(?:of|for|at|on|in|the|every|each|day|days|daily|a|per|and|to|i|want|um|am|und|die|der|dem|pro|vor|nach|mal|im|jeden|tag|tage|alle|mit|ich|möchte|uhr|pm|am|times?|x|week|month|woche|monat)$/i;
		for (const [text] of [...EN, ...DE]) {
			const s = readHabit(text, STARTER);
			if (s.stop) continue;
			const back = `${s.name} ${s.amount ?? ''} ${s.unit ?? ''} ${JSON.stringify(s.days)} ${s.part ?? ''} ${s.time ?? ''}`.toLowerCase();
			for (const w of text.toLowerCase().match(/\p{L}{4,}/gu) ?? []) if (!filler.test(w) && !back.includes(w.slice(0, 3))) expect(['once', 'twice', 'three', 'drei', 'zweimal', 'dreimal', 'einmal', 'weekly', 'monthly', 'monatlich', 'other', 'zweiten', 'minutes', 'hours', 'weekdays', 'werktags', 'weekends', 'wochenende', 'before', 'after', 'dinner', 'lunch', 'schlafen', 'essen', 'abends', 'morgen', 'morgens', 'nachmittags', 'täglich', 'sundays', 'sunday', 'sonntag', 'sonntags', 'monday', 'thursday', 'montags', 'donnerstags', 'night', 'want']).toContain(w);
		}
	});
	it('never takes a short word for a day, nor a number out of a word', () => {
		expect(readHabit('do laundry', STARTER).days).toEqual({ kind: 'every', every: 1 });
		expect(readHabit('mp3 sorting', STARTER).name).toBe('Mp3 sorting');
	});
});
