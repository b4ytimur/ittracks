<script lang="ts">
	import { page } from '$app/state';
	import { deleteHere, goneAt } from '$lib/undelete';
	import { onMount, tick, untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import type { ActionData, PageData } from './$types';
	import SaidLine from '$lib/detail/SaidLine.svelte';
	import DeviceReminders from '$lib/settings/DeviceReminders.svelte';
	import { noReminder, reminderWords } from '$lib/reminder';
	import { everySection, KINDS, LINES_FOR, movedSections, SECTIONS, type Kind, type Section } from '$lib/detail/sections';
	import { saveSetting } from '$lib/settings/save';
	import type { Mode } from '$lib/ui/list';
	import * as W from '$lib/detail/words';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import GroupHeading from '$lib/ui/GroupHeading.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import MenuButton, { type Way } from '$lib/ui/MenuButton.svelte';
	import RecordTabs from '$lib/detail/RecordTabs.svelte';
	import { dismiss, showError, showToast } from '$lib/toast.svelte';
	import { deserialize, enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { Snippet } from 'svelte';
	import type { HabitForm, PlainScheduleForm, ScheduleForm } from '$lib/forms';
	import OptionList from '$lib/OptionList.svelte';
	import { describeSchedule, lengthText } from '$lib/describe';
	import FillRuleEditor from './FillRuleEditor.svelte';
	import NoteBox from '$lib/NoteBox.svelte';
	import { limitOn, nextDrop } from '$lib/engine/limit';
	import { sameSchedule, scheduleStartBy, startMovedBack } from '$lib/engine/unlogged';
	import { tidyPhases, variantsIn, type Schedule } from '$lib/engine/schedule';
	import { fitFollow, pairByName } from '$lib/engine/follow';
	import ScheduleFields from '$lib/ui/ScheduleFields.svelte';
	import EditableList from '$lib/ui/EditableList.svelte';
	import { addPhase, fitVariants, isPlainKind, phaseDates, plainOfKind, removePhase, savedPlain, type PhaseRow } from '$lib/ui/schedule';
	import { blocked } from '$lib/rules/core';
	import { checkHabit, habitPast, habitRules } from '$lib/rules/habit';
	import { lockedNow } from '$lib/rules/history';

	let {
		data,
		form,
		openLines = [],
		seed = null,
		onreset
	}: {
		data: PageData;
		form: ActionData;
		/** Lines that stand open to begin with. */
		openLines?: string[];
		/** A schedule that was being changed here before, and isn't saved. */
		seed?: ScheduleForm | null;
		/** Start over from what the server has, with these lines open. */
		onreset: (open?: string[], seed?: ScheduleForm | null) => unknown;
	} = $props();

	type Slot = HabitForm['variants'][number]['slots'][number];

	let h = $state<HabitForm>(untrack(() => structuredClone(data.habit)));
	let mode = $state(untrack(() => data.mode));
	let step = $state(0);
	let pinned = $state(untrack(() => data.pinned));
	let tasks = $state(untrack(() => [...data.tasks]));
	let metricsByTask = $state(untrack(() => ({ ...data.metrics })));
	/** Tasks that log something per set; a Yes or no Task has no sets to aim for. */
	let repeating = $state(untrack(() => new Set(data.repeating)));
	/** History policies (src/lib/rules/history.ts): build or break is fixed once something is logged. */
	const directionLocked = untrack(() => lockedNow(habitPast, 'direction', data.directionLocked));
	/** One raise by steps, per Slot target: "Weight +2.5 kg", in each field's own step and unit. */
	const raiseLines = $derived.by(() => {
		if (h.progression?.unit !== 'steps') return [];
		const by = h.progression.by;
		const out = new Set<string>();
		for (const v of h.variants)
			for (const s of v.slots)
				for (const m of (s.taskId && metricsByTask[s.taskId]) || [])
					if (s.targets[m.id] !== undefined) out.add(`${m.name} +${Math.round(m.step * by * 1000) / 1000}${m.unit ? ` ${m.unit}` : ''}`);
		return [...out];
	});

	// A build habit always has at least one Variant to put Slots in. A group has none: the habits inside it do.
	$effect(() => {
		if (h.direction === 'build' && h.variants.length === 0 && kind !== 'group') addVariant();
	});

	// ----- Schedule editor state, seeded from the saved Schedule -----
	const s0 = untrack(() => seed ?? data.habit.schedule);
	const savedSchedule = untrack(() => data.habit.schedule);
	const savedStart = untrack(() => data.habit.startDate);
	let kind = $state<ScheduleForm['kind']>(s0?.kind ?? 'interval');
	/**
	 * The schedule with days of its own (weekdays, N a week, every N days, a rotation). While
	 * phases, a group or following is picked it keeps the last one, which a first phase starts from.
	 */
	let plain = $state<PlainScheduleForm>(
		untrack(() =>
			s0 && isPlainKind(s0.kind)
				? (({ rollup: _, ...rest }) => rest)(s0 as PlainScheduleForm & { rollup?: unknown }) as PlainScheduleForm
				: s0?.kind === 'phases'
					? structuredClone(s0.phases[0].schedule)
					: { kind: 'interval', every: 1, start: savedStart, variantId: data.habit.variants[0]?.id ?? '' }
		)
	);
	/** Phases: schedules one after another, from `phasesStart`. */
	let phaseKey = 0;
	let phasesStart = $state(s0?.kind === 'phases' ? s0.start : savedStart);
	let phases = $state<PhaseRow[]>(s0?.kind === 'phases' ? s0.phases.map((p) => ({ ...structuredClone(p), key: `p${phaseKey++}` })) : []);
	/** Picking phases for the first time: one week of the schedule set so far, then the same from then on, to change. */
	$effect(() => {
		if (kind === 'phases' && untrack(() => phases.length === 0)) {
			const first = fitVariants($state.snapshot(plain), untrack(() => h.variants), true);
			phases = addPhase([{ key: `p${phaseKey++}`, length: 1, unit: 'week', schedule: first }], `p${phaseKey++}`, first);
		}
	});
	const phaseRanges = $derived(phaseDates(phasesStart, phases));
	/** A group: done when all (null) or this many habits inside are done; the Minimum, or none. */
	let groupTarget = $state<number | null>(s0?.kind === 'group' ? s0.target : s0 && 'rollup' in s0 ? (s0.rollup?.target ?? null) : null);
	let groupMinimum = $state<number | null>(s0?.kind === 'group' ? s0.minimum : s0 && 'rollup' in s0 ? (s0.rollup?.minimum ?? null) : null);
	/** Following the routine it sits in: only on these of the routine's Variants, or null for all. */
	let followOn = $state<string[] | null>(s0?.kind === 'follow' ? s0.on : null);
	/** The Variant a follower logs on any day `followMap` doesn't pair. */
	let followVariant = $state(s0?.kind === 'follow' ? s0.variantId : (untrack(() => data.habit.variants[0]?.id) ?? ''));
	/** A follower's Variant for each of the routine's Variants (routine Variant id -> this habit's). */
	let followMap = $state<Record<string, string>>(s0?.kind === 'follow' ? ({ ...(s0.map ?? {}) } as Record<string, string>) : {});
	/** Why the group choice can't be saved as it stands, from what is logged or inside. */
	const groupProblem = $derived(
		kind === 'group' && data.ownLogs
			? 'This habit has logs, and a group gets its days from the habits inside it. Make a new habit for the group instead.'
			: kind !== 'group' && s0?.kind === 'group' && data.inside.length
				? 'Move the habits inside this group out of it first.'
				: null
	);

	const firstVariant = $derived(h.variants[0]?.id ?? '');

	// ----- Routines: a habit with its own schedule and habits inside it -----
	/** The habit this one sits in, as the Inside picker lists it. */
	const parent = $derived(data.groups.find((g) => g.id === h.parentId) ?? null);
	/** This habit holds habits and has days of its own: its day is judged from theirs too. */
	const isRoutine = $derived(h.direction === 'build' && data.inside.length > 0 && kind !== 'group');
	/** A tracker keeps what you log; nothing on it is done or missed (engine/scoring.ts). */
	const tracker = $derived(h.direction === 'build' && h.scoring === 'track');
	/** A build habit whose days are judged: what only those have shows on it. */
	const scored = $derived(h.direction === 'build' && !tracker);
	/** Following needs a routine to follow. Leaving it switches to a schedule of its own. */
	$effect(() => {
		if (kind === 'follow' && !parent?.routine) untrack(() => (kind = 'interval'));
	});
	/**
	 * Starting to follow a routine (not the one it already followed when the page opened): its
	 * Variants pair with this habit's of the same name, to change. Pairs already made stay.
	 */
	$effect(() => {
		if (kind !== 'follow' || !parent) return;
		const p = parent;
		untrack(() => {
			const already = s0?.kind === 'follow' && data.habit.parentId === p.id;
			if (!already && !p.variants.some((pv) => pv.id in followMap)) followMap = { ...followMap, ...pairByName(p.variants, h.variants) };
		});
	});
	/** The routine's Variants that bring this habit up, each with the Variant it logs then. */
	const followRows = $derived(
		(parent?.variants ?? [])
			.filter((pv) => !followOn || followOn.includes(pv.id))
			.map((pv) => ({ ...pv, logs: [followMap[pv.id], followVariant].find((id) => id && h.variants.some((v) => v.id === id)) ?? firstVariant }))
	);
	function toggleFollowOn(id: string) {
		const all = parent?.variants.map((v) => v.id) ?? [];
		const now = followOn ?? all;
		const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
		followOn = next.length === all.length ? null : next;
	}
	/** A routine's rule, kept with its schedule only when it isn't the default (all, no Minimum). */
	const routineRule = $derived(isRoutine && (groupTarget !== null || groupMinimum !== null) ? { rollup: { target: groupTarget, minimum: groupMinimum } } : {});

	/**
	 * A new start date for the habit. The schedule's own start follows: along with it when the
	 * two were the same day and nothing is logged yet (a new plan begins on the day you give),
	 * else back far enough to cover it, by whole cycles, so planned days keep their Variant.
	 * Phases only move along with it: moving them back would move every phase.
	 */
	function setStart(v: string) {
		if (!v) return;
		const old = h.startDate;
		h.startDate = v;
		if (kind === 'phases') {
			if (phasesStart === old && !data.hasLogs) phasesStart = v;
			return;
		}
		if (plain.kind !== 'interval' && plain.kind !== 'rotation') return;
		if (plain.start === old && !data.hasLogs) plain.start = v;
		else if (v < plain.start) plain.start = (scheduleStartBy(plain as Schedule, v) as { start: string }).start;
	}

	/** The Schedule as it will be saved, with only Variants the habit has. Rotations follow the Variant order. */
	const schedule = $derived.by((): ScheduleForm | null => {
		if (h.direction === 'break') return null;
		const ids = new Set(h.variants.map((v) => v.id));
		switch (kind) {
			case 'phases':
				return tidyPhases({
					kind,
					start: phasesStart,
					phases: phases.map(({ key: _, ...p }) => ({ ...p, schedule: savedPlain(p.schedule, h.variants, false) })),
					...routineRule
				});
			case 'group':
				return { kind, target: groupTarget, minimum: groupMinimum };
			case 'follow':
				return fitFollow(
					{ kind, variantId: ids.has(followVariant) ? followVariant : firstVariant, on: followOn, map: followMap, ...routineRule },
					h.variants.map((v) => v.id),
					parent?.variants.map((v) => v.id)
				);
			default:
				return { ...savedPlain(plain, h.variants, true), ...routineRule };
		}
	});
	/** The routine and this habit each go through Variants on their own, so their days can drift apart. */
	const drifts = $derived(!!parent?.routine && !!parent.rotates && kind !== 'follow' && kind !== 'group' && !!schedule && variantsIn(schedule as Schedule).length > 1);
	/**
	 * A schedule edit on a habit with a past: from today on (the default), or past days too.
	 * Not asked for a habit with no past days yet, or when Started on only moved the
	 * schedule's start back with it: the server keeps no old plan for those.
	 */
	let scheduleApplies = $state<'today' | 'past'>('today');
	const scheduleEdited = $derived(
		!data.isNew && !!savedSchedule && !sameSchedule(savedSchedule, schedule) && savedStart < data.today && !startMovedBack(savedSchedule, schedule, savedStart, h.startDate)
	);

	// ----- Cue, stacking, levels, streak, identity, if-then -----
	let afterMode = $state<'none' | 'habit' | 'text'>(
		untrack(() => (h.cue.afterHabitId ? 'habit' : h.cue.afterText ? 'text' : 'none'))
	);
	const buildHabits = $derived(data.habits.filter((x) => x.direction === 'build'));
	const cue = $derived({
		time: h.cue.time || null,
		place: h.cue.place?.trim() || null,
		afterHabitId: afterMode === 'habit' ? h.cue.afterHabitId || null : null,
		afterText: afterMode === 'text' ? h.cue.afterText?.trim() || null : null,
		range: h.cue.range || null
	});
	const intention = $derived.by(() => {
		const anchor = cue.afterHabitId
			? data.habits.find((x) => x.id === cue.afterHabitId)?.name
			: cue.afterText;
		if (!anchor && !cue.time && !cue.place && !cue.range) return '';
		// Habit names are nouns as often as verbs ("Gym", "Spanish"), so the name leads.
		const place = cue.place && (/^(in|at|on|by|near|under|inside|outside)\s/i.test(cue.place) ? cue.place : `at ${cue.place}`);
		const when = cue.time ? `at ${cue.time}` : cue.range ? `in the ${cue.range.toLowerCase()}` : null;
		const parts = [anchor ? `after ${anchor}` : null, when, place].filter(Boolean);
		return `${h.name.trim() || 'This habit'}: ${parts.join(', ')}.`;
	});

	function setRule(kind: HabitForm['streakRule']['kind']) {
		h.streakRule =
			kind === 'grace'
				? { kind, misses: 1, period: 'week' }
				: kind === 'consistency'
					? { kind, days: 30 }
					: { kind };
	}

	let identities = $state(untrack(() => [...data.identities]));
	let newIdentity = $state('');
	let identityError = $state('');
	function toggleIdentity(id: string) {
		h.identityIds = h.identityIds.includes(id)
			? h.identityIds.filter((x) => x !== id)
			: [...h.identityIds, id];
	}
	async function createIdentity() {
		identityError = '';
		const body = new FormData();
		body.set('statement', newIdentity);
		const res = await fetch('?/identity', {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		const r = deserialize(await res.text());
		if (r.type === 'success' && r.data) {
			const { identityId, statement } = r.data as { identityId: string; statement: string };
			identities.push({ id: identityId, statement });
			h.identityIds = [...h.identityIds, identityId];
			newIdentity = '';
		} else identityError = 'Could not add that identity.';
	}

	function setTarget(map: Record<string, number>, metricId: string, value: string) {
		if (value === '') delete map[metricId];
		else map[metricId] = Number(value);
	}

	let newPrep = $state('');
	function addPrep() {
		const t = newPrep.trim();
		if (t && !h.prep.includes(t)) h.prep = [...h.prep, t];
		newPrep = '';
	}
	const hasTargets = $derived(h.variants.some((v) => v.slots.some((s) => Object.keys(s.targets).length)));
	const numOrNull = (v: string) => (v === '' ? null : Number(v));

	/** "Today's limit: 10. Drops to 9 on Fri 27 Nov." A changed limit applies from today. */
	const limitPreview = $derived.by(() => {
		if (!h.limit) return '';
		const today = new Date().toLocaleDateString('en-CA');
		const saved = data.habit.limit;
		const unchanged =
			saved &&
			saved.max === h.limit.max &&
			saved.period === h.limit.period &&
			JSON.stringify(saved.taper) === JSON.stringify(h.limit.taper);
		const l = { ...h.limit, start: unchanged ? saved.start : today };
		const per = l.period === 'week' ? 'this week' : 'today';
		const next = nextDrop(l, today);
		const when = (d: string) =>
			new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
		return `Limit ${per}: ${limitOn(l, today)}.${next ? ` Drops to ${next.max} on ${when(next.date)}.` : ''}${unchanged ? '' : ' Changes apply from today.'}`;
	});

	// Text typed into "add" boxes but not added yet still counts when saving.
	const pendingPrep = $derived(newPrep.trim() && !h.prep.includes(newPrep.trim()) ? [newPrep.trim()] : []);
	// ----- Conflict rules (src/lib/rules): what is blocked right now, and why -----
	const ruleForm = $derived({ ...h, schedule, cue } as HabitForm);
	const ruleCheck = $derived(checkHabit(ruleForm));
	const timeBlock = $derived(blocked(habitRules, ruleForm, 'cue.time', {}));
	const rangeBlock = $derived(blocked(habitRules, ruleForm, 'cue.range', {}));
	let deviceProblem = $state('');
	const remindBlock = $derived(blocked(habitRules, ruleForm, 'remind', {}));
	const uniq = (xs: string[]) => [...new Set(xs)];

	const payload = $derived(
		JSON.stringify({
			...h,
			schedule,
			cue,
			pinned,
			scheduleApplies: scheduleEdited ? scheduleApplies : 'today',
			prep: [...h.prep, ...pendingPrep]
		})
	);

	// ----- Schedule presets: one tap fills the schedule editor -----
	type Preset = 'daily' | 'weekdays' | 'mwf' | 'three' | 'ab';
	function applyPreset(p: Preset) {
		const v = h.variants[0]?.id;
		if (!v) return;
		const days = (ds: number[]) => Object.fromEntries(ds.map((d) => [String(d), v]));
		if (p === 'daily') plain = { kind: 'weekly', days: days([0, 1, 2, 3, 4, 5, 6]) };
		else if (p === 'weekdays') plain = { kind: 'weekly', days: days([0, 1, 2, 3, 4]) };
		else if (p === 'mwf') plain = { kind: 'weekly', days: days([0, 2, 4]) };
		else if (p === 'three') plain = { kind: 'frequency', times: 3, period: 'week', variantId: v };
		else {
			if (h.variants.length < 2) {
				byDays = true;
				addVariant();
			}
			// A rotation through every Variant, 1 rest day after each, waiting when a day is missed.
			plain = plainOfKind('rotation', $state.snapshot(plain), h.variants, h.startDate);
		}
		kind = plain.kind;
	}
	const presetOn = $derived.by((): Preset | null => {
		if (kind !== plain.kind) return null;
		if (plain.kind === 'frequency' && plain.times === 3 && plain.period === 'week') return 'three';
		if (plain.kind === 'rotation' && plain.step === 'variant' && h.variants.length === 2) return 'ab';
		if (plain.kind !== 'weekly') return null;
		const days = Object.keys(plain.days).filter((d) => plain.kind === 'weekly' && plain.days[d]).sort().join('');
		return days === '0123456' ? 'daily' : days === '01234' ? 'weekdays' : days === '024' ? 'mwf' : null;
	});

	// Features switched off in Settings stay out of the editor unless this habit already uses them.
	const off = (f: string) => data.hidden.includes(f as never);

	// ----- New Task without leaving the editor -----
	let newTaskFor = $state<string | null>(null);
	let newTaskName = $state('');
	let newTaskType = $state(untrack(() => data.types[0]?.key ?? 'count'));
	let newTaskError = $state('');
	async function createTask(s: Slot) {
		newTaskError = '';
		const body = new FormData();
		body.set('name', newTaskName);
		body.set('type', newTaskType);
		body.set('areaId', h.areaId ?? '');
		const res = await fetch('?/quickTask', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const r = deserialize(await res.text());
		if (r.type === 'success' && r.data?.newTask) {
			const t = r.data.newTask as { id: string; name: string; repeats: boolean; metrics: { id: string; name: string; unit: string; step: number; less?: boolean }[] };
			tasks = [...tasks, { id: t.id, name: t.name }].sort((a, b) => a.name.localeCompare(b.name));
			metricsByTask = { ...metricsByTask, [t.id]: t.metrics };
			if (t.repeats) repeating = new Set([...repeating, t.id]);
			s.taskId = t.id;
			s.fillRule = null;
			newTaskFor = null;
			newTaskName = '';
		} else newTaskError = 'Could not create that Task.';
	}

	function duplicateVariant(vi: number) {
		const v = h.variants[vi];
		const letter = String.fromCharCode(65 + h.variants.length);
		h.variants.splice(vi + 1, 0, {
			id: crypto.randomUUID(),
			name: `${v.name} copy`.slice(0, 120) || letter,
			slots: v.slots.map((x) => ({ ...structuredClone($state.snapshot(x)), id: crypto.randomUUID() }))
		});
	}

	/**
	 * Save without reloading the page. A refused save (a conflict, a missing field) keeps
	 * everything typed in, new habit or not, and brings the reason into view.
	 */
	const keepOnError: SubmitFunction = () => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type !== 'failure') return;
		await tick();
		document.querySelector('#habit-form .save-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	};

	const guidedSteps = ['What', 'When', 'Cue', 'Check'];
	const canNext = $derived(step === 0 ? !!h.name.trim() : true);
	const shortDate = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

	/** Archived Variants, with those archived on this visit. */
	let archivedVariants = $state(untrack(() => data.archivedVariants));
	const usedVariant = (id: string) => data.usedVariants.includes(id);
	function removeVariant(v: HabitForm['variants'][number]) {
		if (usedVariant(v.id)) archivedVariants.push($state.snapshot(v) as typeof v);
		h.variants = h.variants.filter((x) => x.id !== v.id);
	}
	function bringBack(v: HabitForm['variants'][number]) {
		archivedVariants = archivedVariants.filter((x) => x.id !== v.id);
		h.variants.push($state.snapshot(v) as typeof v);
	}

	function addVariant() {
		const letter = String.fromCharCode(65 + h.variants.length);
		h.variants.push({ id: crypto.randomUUID(), name: letter, slots: [] });
	}

	/** Slots whose numbers are open. One just added is. */
	let openSlots = $state<Record<string, boolean>>({});
	const slotName = (x: Slot) => (x.fillRule ? 'Auto-filled' : (tasks.find((t) => t.id === x.taskId)?.name ?? 'Pick a Task'));
	const slotWords = (x: Slot) =>
		[
			x.sets ? `${x.sets} ${x.taskId && !repeating.has(x.taskId) ? 'rounds' : 'sets'}` : '',
			...((x.taskId && metricsByTask[x.taskId]) || []).filter((m) => x.targets[m.id] !== undefined).map((m) => `${x.targets[m.id]} ${m.unit || m.name.toLowerCase()}`)
		]
			.filter(Boolean)
			.join(' · ');

	function addSlot(slots: Slot[], open: boolean) {
		const id = crypto.randomUUID();
		openSlots[id] = true;
		slots.push({
			id,
			taskId: open ? null : (tasks[0]?.id ?? null),
			fillRule: open ? { must: {}, mustNot: {}, prefer: [] } : null,
			sets: null,
			targets: {},
			minTargets: {},
			stretchTargets: {}
		});
	}


	// ----- Lines: each saves by itself; what would rewrite past days waits for its own Save -----

	type Key = keyof HabitForm;
	interface Line {
		label: string;
		fields: Key[];
		/** It rewrites past days, so it waits. */
		held?: boolean;
		/** What saving it does to days that are past. */
		effect?: string;
	}
	const JUDGED = 'Past days are judged again by it. What you logged stays.';
	const LINES: Record<string, Line> = $derived({
		name: { label: 'Name', fields: ['name'] },
		// A tracker's days are when it asks: nothing is due or missed on them.
		days: { label: tracker ? 'Asks' : 'Days', fields: ['schedule'], held: true },
		started: { label: h.direction === 'break' ? 'Counting from' : 'Started', fields: ['startDate', 'schedule'], held: true, effect: 'Days from here on count. What you logged stays.' },
		when: { label: 'When and where', fields: ['cue'] },
		remind: { label: 'Reminder', fields: ['remind', 'reminder'] },
		limit: { label: 'Limit', fields: ['limit'], held: true, effect: 'It applies from today. Past days keep the limit they had.' },
		instead: { label: 'Instead', fields: ['ifThen'] },
		what: { label: 'What you do', fields: ['variants'] },
		levels: { label: 'Levels', fields: ['levels'], held: true, effect: JUDGED },
		streak: { label: 'Streak', fields: ['streakRule', 'minimumCounts', 'unlogged'], held: true, effect: JUDGED },
		quick: { label: 'One-tap Done', fields: ['quickDone'] },
		raise: { label: 'Raise targets', fields: ['progression'] },
		feelings: { label: 'Feelings', fields: ['triggers'] },
		cost: { label: 'Cost', fields: ['cost'] },
		identity: { label: 'Identity', fields: ['identityIds'] },
		treat: { label: 'Treat', fields: ['bundle'] },
		reward: { label: 'Celebrate and jar', fields: ['reward'] },
		prep: { label: 'The day before', fields: ['prep'] },
		reframe: { label: 'Reframe', fields: ['reframe'] },
		notes: { label: 'Notes', fields: ['notes'] },
		area: { label: 'Area', fields: ['areaId'] },
		inside: { label: 'Inside', fields: ['parentId', 'schedule'], held: true, effect: 'From today on. The days before keep where it was.' },
		kind: { label: 'Kind', fields: ['direction', 'scoring'], held: true, effect: 'What only the other kind has goes. What you logged stays.' }
	});
	const full = $derived({ ...h, schedule, cue, prep: [...h.prep, ...pendingPrep] } as HabitForm);
	const ordered = (v: unknown): string =>
		JSON.stringify(v ?? null, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
	const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null));
	/** What the server has, as this page writes it and as the server does. */
	let base = $state.raw(untrack(() => ({ ...(copy($state.snapshot(full)) as HabitForm), ...(seed ? { schedule: copy(data.habit.schedule) } : {}) })));
	/** Put inside a group or routine, with past days: from today on (the default), or its past days too. */
	let moveApplies = $state<'today' | 'past'>('today');
	const movedIn = $derived(!data.isNew && !!h.parentId && h.parentId !== base.parentId && savedStart < data.today);
	/** Which days a line's change is for. */
	const appliesOf = (id: string): 'today' | 'past' =>
		id === 'inside' && movedIn ? moveApplies : id === 'days' || id === 'started' || id === 'inside' ? (scheduleEdited ? scheduleApplies : 'today') : 'today';
	let onServer = $state.raw(untrack(() => copy(data.habit)));
	const changedKey = (k: Key) => ordered(full[k]) !== ordered(base[k]);
	const edited = $derived(Object.fromEntries(Object.entries(LINES).map(([id, l]) => [id, l.fields.some(changedKey)])));
	/** A preset of Days made a second Variant: the two are one change. */
	let byDays = $state(false);
	/** The fields a line saves: a schedule names Variants, so one never goes without the other it needs. */
	function keysOf(id: string): Key[] {
		const ids = (f: HabitForm) => f.variants.map((v) => v.id).join();
		const others: Key[] =
			id === 'what' && ids(full) !== ids(base) ? ['schedule'] : id === 'days' && byDays ? ['variants'] : id === 'kind' ? ['variants', 'schedule', 'limit', 'cost', 'triggers', 'parentId', 'levels', 'streakRule', 'minimumCounts', 'unlogged', 'quickDone', 'progression', 'reward'] : [];
		return [...LINES[id].fields, ...others].filter(changedKey);
	}
	/** Two lines that share a field: the one that was opened for it holds it. */
	const holds = (id: string) => !data.isNew && !!LINES[id].held && edited[id] && !(id !== 'days' && LINES[id].fields.every((k) => !changedKey(k) || k === 'schedule') && edited.days);

	let opened = $state<Record<string, boolean>>(untrack(() => Object.fromEntries((data.isNew ? ["name", ...openLines] : openLines).map((k) => [k, true]))));
	let added = $state<Record<string, boolean>>({});
	let problems = $state<Record<string, string>>({});
	let saving = $state<Record<string, boolean>>({});
	let elsewhere = $state<{ id: string; moved: Partial<HabitForm> } | null>(null);
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	/** One entry in the band per line and visit, with the value the visit began with. */
	const said = new Map<string, { entry: number; was: Partial<HabitForm> }>();

	/** Its own, read once: an Undo in the band is pressed on other pages too, where `data` is theirs. */
	const HABIT = untrack(() => data.id);
	async function send(id: string, body: object): Promise<{ status: number; r: { form?: HabitForm; undo?: string; error?: string; moved?: Partial<HabitForm>; said?: string } } | null> {
		const res = await fetch(`/api/habits/${HABIT}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => null);
		if (!res) return null;
		return { status: res.status, r: await res.json().catch(() => ({})) };
	}
	const pick = (f: HabitForm, keys: Key[]) => Object.fromEntries(keys.map((k) => [k, copy(f[k])])) as Partial<HabitForm>;

	async function saveLine(id: string, applies: 'today' | 'past' = 'today') {
		const l = LINES[id];
		const keys = keysOf(id);
		clearTimeout(timers.get(id));
		timers.delete(id);
		if (!keys.length) return;
		// One at a time per line; the one under way looks again when it is done.
		if (saving[id]) return void (l.held || wait(id));
		saving[id] = true;
		const set = pick(full, keys);
		const was = pick(onServer, keys);
		const gone = keys.includes('variants') && base.variants.some((v) => !set.variants!.some((x) => x.id === v.id));
		const keep = !!l.held || gone;
		const a = await send(id, { set, was, applies, keep });
		saving[id] = false;
		if (!a) {
			problems[id] = 'Not saved. Are you online? It is tried again when you change something here.';
			return;
		}
		if (a.status === 409 && a.r.moved) {
			elsewhere = { id, moved: a.r.moved };
			return;
		}
		if (!a.r.form) {
			problems[id] = a.r.error ?? 'Not saved.';
			return;
		}
		problems[id] = '';
		base = { ...base, ...set };
		onServer = a.r.form;
		tell(id, keys, was, a.r.undo, a.r.said);
		if (l.held) {
			byDays = false;
			forgetHeld();
			flush();
			onreset(Object.keys(opened).filter((k) => opened[k] && k !== id));
			return;
		}
		// Changed while it was being saved.
		if (!l.held && keys.some(changedKey)) wait(id);
	}
	/** The band says what changed, with its way back. It works from any page. */
	function tell(id: string, keys: Key[], was: Partial<HabitForm>, undo?: string, also?: string) {
		const l = LINES[id];
		const name = full.name;
		if (undo) {
			// `also`: another habit the change moved too (a routine started where this one is).
			showToast(`Changed ${l.label.toLowerCase()} of ${name}.${also ? ` ${also}` : ''}`, async () => {
				const r = await fetch('/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: undo }) }).catch(() => null);
				if (!r?.ok) return r?.status === 409 ? `${name} changed again since, so it is left as it is.` : false;
				// Before the band reloads the page itself: two reloads at once would show the older one.
				await onreset();
				return true;
			});
			return;
		}
		const first = said.get(id);
		if (first) dismiss(first.entry);
		const back = { ...was, ...(first?.was ?? {}) };
		const now = pick(onServer, Object.keys(back) as Key[]);
		// A new Area counts from today on, so Stats keep its past days where they were; asked here, past days too.
		const areaMoved = id === 'area' && savedStart < data.today && back.areaId !== undefined && back.areaId !== onServer.areaId;
		const text = id === 'name' ? `Renamed to ${name}.` : `Changed ${l.label.toLowerCase()} of ${name}${areaMoved ? ', from today on' : ''}.`;
		const entry = showToast(text, async () => {
			const a = await send(id, { set: back, was: now });
			if (!a) return false;
			if (!a.r.form) return a.status === 409 ? `${l.label} changed again since, so it is left as it is.` : false;
			said.delete(id);
			await onreset(Object.keys(opened).filter((k) => opened[k]));
			return true;
		}, undefined, areaMoved ? { label: 'Past days too', run: areaPastToo } : undefined);
		said.set(id, { entry, was: back });
	}
	/** The new Area counts on the habit's past days too, with an Undo back to from today on. */
	async function areaPastToo() {
		const areaId = onServer.areaId;
		const a = await send('area', { set: { areaId }, was: { areaId }, applies: 'past', keep: true });
		if (!a?.r.form) return a?.r.error ?? false;
		const where = data.areas.find((x) => x.id === areaId)?.name;
		const undo = a.r.undo;
		showToast(
			`${full.name} counts ${where ? `in ${where}` : 'in no Area'} on its past days too.`,
			undo ? async () => (await fetch('/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: undo }) }).catch(() => null))?.ok ?? false : undefined
		);
	}
	function wait(id: string) {
		clearTimeout(timers.get(id));
		timers.set(id, setTimeout(() => saveLine(id), 800));
	}
	$effect(() => {
		if (data.isNew) return;
		const ids = Object.keys(LINES).filter((id) => !LINES[id].held && edited[id] && !(id === 'what' && byDays));
		void ordered(ids.map((id) => pick(full, LINES[id].fields)));
		untrack(() => ids.forEach(wait));
	});
	const flush = () => [...timers.keys()].forEach((id) => void saveLine(id));
	beforeNavigate(flush);

	// A held change is kept on this device until it is saved or cancelled.
	const HELD = untrack(() => `habit-held:${data.id}`);
	const heldIds = $derived(data.isNew ? [] : Object.keys(LINES).filter((id) => holds(id)));
	let cameBack = $state('');
	let watching = false;
	function forgetHeld() {
		watching = false;
		try {
			localStorage.removeItem(HELD);
		} catch {
			/* storage blocked */
		}
	}
	$effect(() => {
		const keys = [...new Set(heldIds.flatMap((id) => LINES[id].fields))];
		const now = JSON.stringify({ at: Date.now(), ids: heldIds, set: pick(full, keys), was: pick(base, keys) });
		if (!watching || data.isNew) return;
		try {
			if (heldIds.length) localStorage.setItem(HELD, now);
			else localStorage.removeItem(HELD);
		} catch {
			/* storage blocked */
		}
	});
	onMount(() => {
		try {
			const d = JSON.parse(localStorage.getItem(HELD) ?? 'null') as { at: number; ids: string[]; set: Partial<HabitForm>; was: Partial<HabitForm> } | null;
			// Only over the values it was made from.
			if (d && Object.keys(d.was).every((k) => ordered(d.was[k as Key]) === ordered(base[k as Key]))) {
				// The schedule's controls are made from it, so the page starts over with it once.
				if (d.set.schedule && !seed) return void onreset(d.ids, d.set.schedule);
				const { schedule: _, ...rest } = d.set;
				Object.assign(h, rest);
				for (const id of d.ids) opened[id] = true;
				cameBack = new Date(d.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
			}
		} catch {
			/* storage blocked */
		}
		watching = true;
	});
	function cancelLine(id: string) {
		if (LINES[id].fields.includes('schedule')) {
			// The schedule's own controls start over with the page.
			forgetHeld();
			onreset(Object.keys(opened).filter((k) => opened[k]));
			return;
		}
		Object.assign(h, pick(base, LINES[id].fields));
		problems[id] = '';
	}
	/** Show what the other device saved, or save this one over it. */
	function showTheirs() {
		forgetHeld();
		onreset(elsewhere ? [elsewhere.id] : []);
	}
	function keepMine() {
		if (!elsewhere) return;
		const { id, moved } = elsewhere;
		onServer = { ...onServer, ...moved };
		elsewhere = null;
		void saveLine(id, scheduleApplies);
	}

	// What each line says, now and as it was.
	const nameOf = (id: string | null) => data.habits.find((x) => x.id === id)?.name;
	const say = (f: HabitForm): Record<string, string> => ({
		name: f.name,
		days: W.sentence(describeSchedule(f.schedule, parent ?? undefined, f.variants)),
		started: shortDate(f.startDate),
		when: W.cueWords(f.cue, f.cue.afterHabitId ? nameOf(f.cue.afterHabitId) : undefined),
		limit: W.limitWords(f.limit),
		instead: W.insteadWords(f.ifThen, f.ifThen.habitId ? nameOf(f.ifThen.habitId) : undefined),
		levels: W.levelWords(f.levels),
		streak: W.streakWords(f, { group: f.schedule?.kind === 'group', build: f.direction === 'build' }),
		quick: f.quickDone ? 'Done logs the whole plan in one tap.' : 'Off.',
		raise: W.raiseWords(f.progression),
		feelings: W.listWords(f.triggers.map((x) => x.name), 'None.'),
		cost: W.costWords(f.cost),
		identity: W.listWords(f.identityIds.map((id) => identities.find((x) => x.id === id)?.statement ?? '')),
		treat: W.treatWords(f.bundle),
		reward: [W.celebrateWords(f.reward), W.jarWords(f.reward.jar)].filter(Boolean).join(' '),
		prep: W.listWords(f.prep),
		remind: reminderWords(f),
		reframe: f.reframe,
		notes: W.noteWords(f.notes),
		area: data.areas.find((a) => a.id === f.areaId)?.name ?? 'None.',
		inside: data.groups.find((g) => g.id === f.parentId)?.name ?? 'Nothing: it stands on its own.',
		kind: f.direction === 'break' ? 'Break: something to stop.' : f.scoring === 'track' ? 'Track: something to keep a log of.' : 'Build: something to do.'
	});
	const now = $derived(say(full));
	const before = $derived(say(base));

	const isGroupKind = $derived(kind === 'group');
	const build = $derived(h.direction === 'build');
	/** Lines that show only while they hold something, or were just added. */
	const optional: Record<string, { on: boolean; can: boolean; clear: () => void; word: string }> = $derived({
		when: { on: !!now.when, can: build, clear: () => ((h.cue = { time: null, place: null, afterHabitId: null, afterText: null, range: null }), (afterMode = 'none'), h.reminder?.time || (h.remind = false)), word: 'When and where' },
		remind: { on: h.remind || base.remind, can: build && !isGroupKind, clear: () => (h.remind = false), word: 'Reminder' },
		instead: { on: !!now.instead, can: !build && !off('ifThen'), clear: () => (h.ifThen = { when: '', then: '', habitId: null }), word: 'Instead' },
		levels: { on: scored && (h.levels.enabled || base.levels.enabled), can: scored && !isGroupKind && !off('levels'), clear: () => (h.levels.enabled = false), word: 'Levels' },
		streak: { on: scored && (base.streakRule.kind !== 'neverTwice' || base.unlogged === 'ignore' || !base.minimumCounts || edited.streak), can: scored, clear: () => ((h.streakRule = { kind: 'neverTwice' }), (h.unlogged = 'missed'), (h.minimumCounts = true)), word: 'Streak and days you don’t log' },
		quick: { on: scored && (h.quickDone || base.quickDone), can: scored && !isGroupKind && h.variants.some((v) => v.slots.length), clear: () => (h.quickDone = false), word: 'One-tap Done' },
		raise: { on: scored && !!h.progression, can: scored && hasTargets && !off('progression'), clear: () => (h.progression = null), word: 'Raise targets' },
		cost: { on: !!h.cost, can: !build && !off('cost'), clear: () => (h.cost = null), word: 'Cost' },
		identity: { on: h.identityIds.length > 0, can: !off('identities'), clear: () => (h.identityIds = []), word: 'Identity' },
		treat: { on: !!h.bundle.reward, can: build && !off('rewards'), clear: () => (h.bundle = { reward: '', strict: false }), word: 'Treat' },
		reward: { on: h.reward.celebrate || !!h.reward.jar, can: build && !off('rewards'), clear: () => (h.reward = { celebrate: false, message: '', jar: null }), word: 'Celebrate and jar' },
		prep: { on: h.prep.length > 0, can: build && !off('prep'), clear: () => ((h.prep = []), (newPrep = '')), word: 'The day before' },
		reframe: { on: !!h.reframe, can: !off('reframe'), clear: () => (h.reframe = ''), word: 'Reframe' },
		notes: { on: !!h.notes, can: true, clear: () => (h.notes = ''), word: 'Notes' },
		inside: { on: !!h.parentId || !!base.parentId, can: scored && data.groups.length > 0, clear: () => (h.parentId = null), word: 'Inside a group or routine' }
	});
	const shows = (id: string) => optional[id].on || (added[id] && (optional[id].can || optional[id].on)) || (data.isNew && !!data.newLines[pageKind]?.includes(id) && optional[id].can);
	// The sections under the first card, in the order this kind of habit has them.
	let arranging = $state<Mode>('use');
	const pageKind = $derived<Kind>(!build ? 'break' : isGroupKind ? 'group' : tracker ? 'track' : 'build');
	const order = $derived(everySection(data.detail[pageKind]));
	const sections = $derived(
		order.filter(
			(x) =>
				({
					what: build && !isGroupKind,
					counts: build && ['levels', 'streak', 'quick', 'raise'].some(shows),
					slip: !build,
					keeps: ['identity', 'treat', 'reward', 'prep', 'reframe'].some(shows),
					about: true
				})[x]
		)
	);
	const sectionTitle = (x: Section) => (x === 'what' && h.variants.length > 1 ? 'Variants' : SECTIONS[x]);
	const everyOne = $derived(`on every ${KINDS[pageKind]}`);
	async function arrange(next: Section[] | undefined, said: string) {
		const kinds = { ...data.detail };
		if (next) kinds[pageKind] = next;
		else delete kinds[pageKind];
		const why = await saveSetting({ detail: kinds }, () => ({ detail: data.detail }), said);
		if (why) showError(why);
	}
	const moveSection = (x: Section, shown: Section[]) => void arrange(movedSections(order, shown), `Moved ${sectionTitle(x)} to ${shown.indexOf(x) + 1} of ${shown.length}, ${everyOne}.`);
	// Which lines every new one of this kind starts with.
	const FEATURE: Partial<Record<string, Parameters<typeof off>[0]>> = { levels: 'levels', raise: 'progression', cost: 'cost', identity: 'identities', treat: 'rewards', reward: 'rewards', prep: 'prep', reframe: 'reframe', instead: 'ifThen' };
	const startLines = $derived(LINES_FOR[pageKind].filter((id) => !FEATURE[id] || !off(FEATURE[id]!)));
	async function startWith(id: string) {
		const now = data.newLines[pageKind] ?? [];
		const on = !now.includes(id);
		const next = { ...data.newLines, [pageKind]: on ? [...now, id] : now.filter((x) => x !== id) };
		const why = await saveSetting({ newLines: next }, () => ({ newLines: data.newLines }), on ? `Every new ${KINDS[pageKind]} starts with ${optional[id].word}.` : `A new ${KINDS[pageKind]} no longer starts with ${optional[id].word}.`);
		if (why) showError(why);
	}
	const toAdd = $derived(Object.keys(optional).filter((id) => optional[id].can && !shows(id)));
	let morePills = $state(false);
	function add(id: string) {
		added[id] = true;
		opened[id] = true;
		if (id === 'levels') h.levels.enabled = true;
		if (id === 'raise') h.progression ??= { after: 6, by: 5, unit: 'percent' };
		if (id === 'cost') h.cost ??= { amount: 1, unit: '€', perDay: null };
		if (id === 'quick') h.quickDone = true;
		if (id === 'reward' && !h.reward.celebrate && !h.reward.jar) h.reward.celebrate = true;
		tick().then(() => {
			const el = document.getElementById(`line-${id}`);
			el?.scrollIntoView({ block: 'nearest' });
			el?.querySelector<HTMLElement>('.su-body input, .su-body select, .su-body textarea, .su-body button')?.focus();
		});
	}
	function remove(id: string) {
		optional[id].clear();
		if (!LINES[id].held || data.isNew) {
			added[id] = false;
			opened[id] = false;
		}
	}
	const menu = $derived<(Way | '-')[]>(
		data.isNew
			? []
			: [
					{ label: 'Duplicate', href: `/habits/new?from=${data.id}` },
					...(s0?.kind !== 'group' || data.inside.some((x) => !x.archived) ? [{ label: 'Share as a template', href: `/habits/${data.id}/share` }] : []),
					'-' as const,
					data.archived ? { label: 'Unarchive', action: '?/unarchive' } : { label: 'Archive', action: '?/archive' },
					{ label: 'Delete…', onselect: () => deleteHere('habit', data.id, h.name, '/habits') }
				]
	);
	async function setPinned(v: boolean) {
		pinned = v;
		const a = await send('pinned', { set: {}, was: {}, pinned: v });
		if (!a || a.status >= 400) {
			pinned = !v;
			showError('Not saved. Are you online?');
		}
	}
</script>

<svelte:head><title>{data.isNew ? 'New habit' : h.name} · ittracks</title></svelte:head>

{#snippet whatYouDo()}
	{#if h.variants.length > 1}<p class="meta lead">Each Variant is a version of this habit, like Push day A and Pull day B.</p>{/if}
	<EditableList
		items={h.variants}
		key={(v) => v.id}
		label={(v) => v.name || 'Variant'}
		mode={h.variants.length > 1 ? 'edit' : 'use'}
		layout="bare"
		ariaLabel="Variants"
		onmove={(_, order) => (h.variants = order.map((k) => h.variants.find((v) => v.id === k)!))}
	>
		{#snippet row(v, ctx)}
			<div class="holder variant">
				{#if h.variants.length > 1}
					<div class="card">
						<div class="slot">{@render ctx.grip?.()}</div>
						<div class="content"><input class="grow" aria-label="Name of the Variant" bind:value={v.name} required maxlength="120" /></div>
						<div class="verb">
							<MenuButton label="More for {v.name}" items={[{ label: 'Duplicate', onselect: () => duplicateVariant(h.variants.indexOf(v)) }, { label: usedVariant(v.id) ? 'Archive' : 'Remove', value: usedVariant(v.id) ? 'Past days keep it.' : undefined, onselect: () => removeVariant(v) }]} />
						</div>
					</div>
				{/if}
				<div class="shelf">
					<EditableList
						items={v.slots}
						key={(x) => x.id}
						label={(x) => slotName(x)}
						mode={v.slots.length ? 'edit' : 'use'}
						layout="bare"
						ariaLabel="Tasks{h.variants.length > 1 ? ` of ${v.name}` : ''}"
						onmove={(_, order) => (v.slots = order.map((k) => v.slots.find((x) => x.id === k)!))}
					>
						{#snippet row(s, sctx)}
							<div class="su-slot">
								<div class="su-slot-head">
									<span class="slot">{@render sctx.grip?.()}</span>
									<strong class="grow">{slotName(s)}</strong>
									<button type="button" class="quiet" aria-expanded={!!openSlots[s.id]} aria-label="{openSlots[s.id] ? 'Close' : 'Change'} {slotName(s)}" onclick={() => (openSlots[s.id] = !openSlots[s.id])}>{openSlots[s.id] ? 'Close' : 'Change'}</button>
									<button type="button" class="quiet" aria-label="Remove {slotName(s)}" onclick={() => (v.slots = v.slots.filter((x) => x !== s))}>Remove</button>
								</div>
								{#if !openSlots[s.id]}
									{#if slotWords(s)}<p class="meta su-slot-words">{slotWords(s)}</p>{/if}
								{:else}
									<div class="stack su-slot-body">
					{#if s.fillRule}
						<FillRuleEditor bind:rule={s.fillRule} tags={data.tags} />
					{:else}
						<label
							>Task
							<select
								value={s.taskId ?? ''}
								onchange={(e) => {
									if (e.currentTarget.value === '__new') {
										newTaskFor = s.id;
										e.currentTarget.value = s.taskId ?? '';
									} else s.taskId = e.currentTarget.value;
								}}
								required
							>
								{#each tasks as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
								<option value="__new">+ New Task…</option>
							</select>
						</label>
					{/if}
					{#if newTaskFor === s.id}
						<div class="card stack newtask">
							<label>New Task name <input bind:value={newTaskName} placeholder="Bench press" /></label>
							<div class="chips">
								{#each data.types as type (type.key)}
									<button type="button" class="toggle" aria-pressed={newTaskType === type.key} onclick={() => (newTaskType = type.key)}>{type.name}</button>
								{/each}
							</div>
							<p class="muted meta">{data.types.find((x) => x.key === newTaskType)?.description}</p>
							<div class="row">
								<button type="button" class="primary" onclick={() => createTask(s)} disabled={!newTaskName.trim()}>Create and use</button>
								<button type="button" onclick={() => (newTaskFor = null)}>Cancel</button>
							</div>
							{#if newTaskError}<p class="error">{newTaskError}</p>{/if}
						</div>
					{/if}
					{#if s.taskId && !repeating.has(s.taskId) && data.withParts.includes(s.taskId)}
						<label style="width: 8rem"
							>Rounds
							<input
								type="number"
								min="0"
								max="50"
								value={s.sets ?? ''}
								oninput={(e) => (s.sets = e.currentTarget.value ? Number(e.currentTarget.value) : null)}
							/>
						</label>
					{:else if !s.taskId || repeating.has(s.taskId)}
						<label style="width: 8rem"
							>Target sets
							<input
								type="number"
								min="0"
								max="50"
								value={s.sets ?? ''}
								oninput={(e) => (s.sets = e.currentTarget.value ? Number(e.currentTarget.value) : null)}
							/>
						</label>
					{/if}
					<!-- A tracker has no goal to aim for (rule T2). -->
					{#if scored && !s.fillRule && s.taskId && metricsByTask[s.taskId]?.length}
						<table class="targets">
							<thead>
								<tr>
									<th></th>
									{#if h.levels.enabled}<th>Minimum</th>{/if}
									<th>Target</th>
									{#if h.levels.enabled}<th>Stretch</th>{/if}
								</tr>
							</thead>
							<tbody>
								{#each metricsByTask[s.taskId] as m (m.id)}
									<tr>
										<td>{m.name}{m.unit ? ` (${m.unit})` : ''}{m.less ? ', at most' : ''}</td>
										{#if h.levels.enabled}
											<td><input type="number" step="any" inputmode="decimal" value={s.minTargets[m.id] ?? ''}
												oninput={(e) => setTarget(s.minTargets, m.id, e.currentTarget.value)} aria-label="{m.name} minimum" /></td>
										{/if}
										<td><input type="number" step="any" inputmode="decimal" value={s.targets[m.id] ?? ''}
											oninput={(e) => setTarget(s.targets, m.id, e.currentTarget.value)} aria-label="{m.name} target" /></td>
										{#if h.levels.enabled}
											<td><input type="number" step="any" inputmode="decimal" value={s.stretchTargets[m.id] ?? ''}
												oninput={(e) => setTarget(s.stretchTargets, m.id, e.currentTarget.value)} aria-label="{m.name} stretch" /></td>
										{/if}
									</tr>
								{/each}
							</tbody>
						</table>
						{#if metricsByTask[s.taskId].some((m) => m.less)}
							<p class="meta muted">Less is better for a field marked “at most”: a day at or under its target is done.{h.levels.enabled ? ' Its Minimum is the most that still counts, its Stretch the least.' : ''}</p>
						{/if}
					{/if}
									</div>
								{/if}
							</div>
						{/snippet}
					</EditableList>
					<div class="su-slot-add">
			{#if isRoutine}
				<p class="muted meta">Its Tasks are the habits inside it, so it has none of its own for now.</p>
			{:else}
			<div class="row">
				{#if tasks.length}
					<button type="button" onclick={() => addSlot(v.slots, false)}>+ Task</button>
				{:else}
					<button type="button" onclick={() => { addSlot(v.slots, false); newTaskFor = v.slots.at(-1)!.id; }}>+ New Task</button>
				{/if}
				<button type="button" onclick={() => addSlot(v.slots, true)}>+ Auto-filled</button>
			</div>
			{/if}
			{#if !v.slots.length && !isRoutine}
				<p class="muted meta">No Tasks means there's nothing to fill in: you just tick it off.</p>
			{/if}
					</div>
				</div>
			</div>
		{/snippet}
	</EditableList>
	<button type="button" onclick={addVariant}>{h.variants.length > 1 ? '+ Variant' : '+ Another Variant (for A/B plans)'}</button>
	{#each archivedVariants as v (v.id)}
		<p class="meta muted archived">{v.name} is archived. <button type="button" class="quiet" aria-label="Bring back {v.name}" onclick={() => bringBack(v)}>Bring back</button></p>
	{/each}
{/snippet}

{#snippet schedulePart()}
	{#if kind !== 'group'}
	<div class="chips" role="group" aria-label="Quick schedules">
		<button type="button" class="toggle" aria-pressed={presetOn === 'daily'} onclick={() => applyPreset('daily')}>Every day</button>
		<button type="button" class="toggle" aria-pressed={presetOn === 'weekdays'} onclick={() => applyPreset('weekdays')}>Weekdays</button>
		<button type="button" class="toggle" aria-pressed={presetOn === 'mwf'} onclick={() => applyPreset('mwf')}>Mon, Wed, Fri</button>
		<button type="button" class="toggle" aria-pressed={presetOn === 'three'} onclick={() => applyPreset('three')}>3 times a week</button>
		<button type="button" class="toggle" aria-pressed={presetOn === 'ab'} onclick={() => applyPreset('ab')}>A/B with 1 rest day</button>
	</div>
	{/if}
	<ScheduleFields
		bind:value={plain}
		bind:kind
		variants={h.variants}
		start={h.startDate}
		more={[
			{ value: 'phases', label: 'In phases: one schedule after another' },
			{ value: 'group', label: 'From the habits inside it (a group)' },
			...(parent?.routine ? [{ value: 'follow', label: `Whenever ${parent.name} is due` }] : [])
		]}
	/>
	{#if groupProblem}<p class="error meta">{groupProblem}</p>{/if}
	{#if drifts && parent}
		<p class="muted meta">
			{parent.name} goes through its own Variants too, so the two can drift apart. To keep them in step, pick "Whenever {parent.name} is due" and choose
			this habit's Variant for each of {parent.name}'s.
		</p>
	{/if}

	{#if kind === 'phases'}
		<p class="muted meta">
			Each phase runs its own schedule from its first day, then the next one takes over. Use a Variant per phase to change the targets: 5 a day
			with one Variant for a week, then 1 a day with another.
		</p>
		<label style="width: 12rem">Starting <input type="date" bind:value={phasesStart} /></label>
		<EditableList
			items={phases}
			key={(p) => p.key}
			label={(p) => `Phase ${phases.indexOf(p) + 1}`}
			mode="edit"
			layout="block"
			ariaLabel="Phases"
			onmove={(_, order) => (phases = order.map((k) => phases.find((p) => p.key === k)!))}
			onremove={(p) => (phases = removePhase(phases, p.key))}
			onadd={() => (phases = addPhase($state.snapshot(phases), `p${phaseKey++}`, $state.snapshot(plain)))}
			addLabel="phase"
		>
			{#snippet title(p)}
				{@const i = phases.indexOf(p)}
				{@const r = phaseRanges[i]}
				<strong>Phase {i + 1}</strong>
				<span class="muted meta"
					>{r?.from ? (r.to ? `${shortDate(r.from)} to ${shortDate(r.to)}` : `from ${shortDate(r.from)} on`) : 'never comes: a phase before it has no end'}</span
				>
			{/snippet}
			{#snippet row(p)}
				<div class="stack">
					<div class="row">
						{#if p.length !== null}
							<label style="width: 6rem">For <input type="number" min="1" max="520" bind:value={p.length} aria-label="Phase length" /></label>
						{/if}
						<label class="grow"
							>{p.length === null ? 'Runs' : 'Unit'}
							<select
								value={p.length === null ? 'end' : p.unit}
								onchange={(e) => {
									const v = e.currentTarget.value;
									if (v === 'end') p.length = null;
									else {
										p.unit = v as 'day' | 'week';
										p.length ??= 1;
									}
								}}
							>
								<option value="day">days</option>
								<option value="week">weeks</option>
								<option value="end">from then on, with no end</option>
							</select>
						</label>
					</div>
					<ScheduleFields bind:value={p.schedule} variants={h.variants} start={phasesStart} subset showStart={false} label="Schedule in this phase" />
				</div>
			{/snippet}
		</EditableList>
		{#if phases.length && phases.at(-1)?.length !== null}
			{@const last = phases.at(-1)!}
			<p class="muted meta">
				After the last phase ({lengthText(last.length!, last.unit)}) nothing is due. Pick "from then on" on it to keep going.
			</p>
		{/if}
	{:else if kind === 'group'}
		<p class="muted meta">
			A group has no Tasks of its own. It is due on days a habit inside it is due, and its streak counts the days enough of them were done.
		</p>
		<label
			>Done when
			<select
				value={groupTarget === null ? 'all' : 'some'}
				onchange={(e) => (groupTarget = e.currentTarget.value === 'all' ? null : Math.max(1, Math.min(groupMinimum !== null ? groupMinimum + 1 : 2, 100)))}
			>
				<option value="all">Every habit inside that is due is done</option>
				<option value="some">A number of them are done</option>
			</select>
		</label>
		{#if groupTarget !== null}
			<label style="width: 10rem">How many <input type="number" min="1" max="100" bind:value={groupTarget} /></label>
		{/if}
		<label style="color: var(--ink)"
			><input type="checkbox" checked={groupMinimum !== null} onchange={(e) => (groupMinimum = e.currentTarget.checked ? 1 : null)} /> A day with fewer done still counts at the Minimum</label
		>
		{#if groupMinimum !== null}
			<label style="width: 10rem">Habits for the Minimum <input type="number" min="1" max="100" bind:value={groupMinimum} /></label>
		{/if}
		<p class="muted meta">
			{#if data.inside.length}
				Inside: {data.inside.map((x) => x.name + (x.archived ? ' (archived)' : '')).join(', ')}.
			{:else}
				Nothing inside yet. Open a habit and pick this group under Inside.
			{/if}
			On a day only some are due, "a number" means that many of the ones due.
		</p>
	{:else if kind === 'follow' && parent}
		<p class="muted meta">
			Due on {parent.name}'s days{followOn ? ', with the Variants picked here' : ''}. On Today it shows inside {parent.name}, and marking
			{parent.name} done marks this done too.
		</p>
		{#if parent.variants.length > 1}
			<span class="muted meta">Only when {parent.name} is on</span>
			<div class="chips" role="group" aria-label="{parent.name}'s Variants">
				{#each parent.variants as pv (pv.id)}
					<button type="button" class="toggle" aria-pressed={!followOn || followOn.includes(pv.id)} onclick={() => toggleFollowOn(pv.id)}>{pv.name}</button>
				{/each}
			</div>
		{/if}
		{#if h.variants.length > 1 && parent.variants.length > 1}
			<fieldset class="card">
				<legend class="muted">Variant on each of {parent.name}'s Variants</legend>
				{#each followRows as row (row.id)}
					<label
						>{row.name}
						<select value={row.logs} onchange={(e) => (followMap = { ...followMap, [row.id]: e.currentTarget.value })}>
							{#each h.variants as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
						</select>
					</label>
				{/each}
				{#if !followOn}
					<label
						>Any other day
						<select bind:value={followVariant}>
							{#each h.variants as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
						</select>
					</label>
				{/if}
				<p class="muted meta">
					The two go through their Variants together: whenever {parent.name} is on one of these, this habit logs the Variant picked for it.
				</p>
			</fieldset>
		{/if}
	{/if}

	{#if isRoutine}
		<fieldset class="card">
			<legend class="muted">On its days, judged from the habits inside</legend>
			<label
				>Done when
				<select
					value={groupTarget === null ? 'all' : 'some'}
					onchange={(e) => (groupTarget = e.currentTarget.value === 'all' ? null : Math.max(1, Math.min(groupMinimum !== null ? groupMinimum + 1 : 2, 100)))}
				>
					<option value="all">Every habit inside that is due is done</option>
					<option value="some">A number of them are done</option>
				</select>
			</label>
			{#if groupTarget !== null}
				<label style="width: 10rem">How many <input type="number" min="1" max="100" bind:value={groupTarget} /></label>
			{/if}
			<label style="color: var(--ink)"
				><input type="checkbox" checked={groupMinimum !== null} onchange={(e) => (groupMinimum = e.currentTarget.checked ? 1 : null)} /> A day with fewer done still counts at the Minimum</label
			>
			{#if groupMinimum !== null}
				<label style="width: 10rem">Habits for the Minimum <input type="number" min="1" max="100" bind:value={groupMinimum} /></label>
			{/if}
			<p class="muted meta">
				Inside: {data.inside.map((x) => x.name + (x.archived ? ' (archived)' : '')).join(', ')}. Done on Today marks the ones due done; a day none of
				them is due, you tick it off like any habit.
			</p>
		</fieldset>
	{/if}

	{#if kind === 'follow' && h.variants.length > 1 && (parent?.variants.length ?? 0) < 2}
		<label
			>Variant
			<select bind:value={followVariant}>
				{#each h.variants as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
			</select>
		</label>
	{/if}
{/snippet}

{#snippet cuePart()}
	<div class="row">
		<label style="width: 8rem"
			>Time
			<input type="time" value={h.cue.time ?? ''} disabled={!!timeBlock}
				oninput={(e) => (h.cue.time = e.currentTarget.value || null)} />
		</label>
		{#if data.ranges.length}
			<label class="grow"
				>Or part of the day
				<select value={h.cue.range ?? ''} disabled={!!rangeBlock} onchange={(e) => (h.cue.range = e.currentTarget.value || null)}>
					<option value="">Any</option>
					{#each data.ranges as r (r.name)}<option value={r.name}>{r.name} ({r.start}–{r.end})</option>{/each}
				</select>
			</label>
		{/if}
	</div>
	{#if timeBlock}
		<p class="blocked">{timeBlock.reason}. <button type="button" class="link" onclick={() => (h.cue.range = null)}>Use a time instead</button></p>
	{:else if rangeBlock && data.ranges.length}
		<p class="blocked">{rangeBlock.reason}. <button type="button" class="link" onclick={() => (h.cue.time = null)}>Use a part of the day instead</button></p>
	{/if}
	<label
		>Where <input value={h.cue.place ?? ''} oninput={(e) => (h.cue.place = e.currentTarget.value)} placeholder="in the park" />
	</label>
	<label
		>After
		<select bind:value={afterMode}>
			<option value="none">Nothing in particular</option>
			{#if buildHabits.length}<option value="habit">Another habit</option>{/if}
			<option value="text">Something else I do</option>
		</select>
	</label>
	{#if afterMode === 'habit'}
		<select
			value={h.cue.afterHabitId ?? ''}
			onchange={(e) => (h.cue.afterHabitId = e.currentTarget.value || null)}
			aria-label="Habit to stack after"
		>
			<option value="">Pick a habit</option>
			{#each buildHabits as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
		</select>
	{:else if afterMode === 'text'}
		<input value={h.cue.afterText ?? ''} oninput={(e) => (h.cue.afterText = e.currentTarget.value)}
			placeholder="I pour my morning coffee" aria-label="What this comes after" />
	{/if}
	{#if intention}<p class="intention">{intention}</p>{/if}
{/snippet}

{#snippet remindPart()}
	{@const r = h.reminder ?? noReminder()}
	{@const change = (v: Partial<typeof r>) => (h.reminder = { ...r, ...v })}
	<label class="check"
		><input type="checkbox" class="pick" bind:checked={h.remind} disabled={!!remindBlock && !h.remind} /> Remind me {r.time ? `at ${r.time}` : h.cue.time ? `at ${h.cue.time}` : h.cue.range ? `when the ${h.cue.range.toLowerCase()} starts` : ''}</label
	>
	{#if remindBlock && !h.remind}<p class="meta muted">{remindBlock.reason}, or a time of its own here.</p>{/if}
	<div class="row">
		<label style="width: 9rem">Time of its own <input type="time" value={r.time ?? ''} onchange={(e) => change({ time: e.currentTarget.value || null })} /></label>
		<label class="grow">What it says <input value={r.text} maxlength="120" placeholder="The place, and the Minimum" oninput={(e) => change({ text: e.currentTarget.value })} /></label>
	</div>
	<p class="meta muted">Without a time it follows When and where. The notification offers Done{h.levels.enabled ? ', and what is ticked here' : ', and Snooze if you like'}.</p>
	{#if h.levels.enabled}<label class="check"><input type="checkbox" class="pick" checked={r.minimum} onchange={(e) => change({ minimum: e.currentTarget.checked })} /> Minimum</label>{/if}
	<label class="check"><input type="checkbox" class="pick" checked={r.snooze} onchange={(e) => change({ snooze: e.currentTarget.checked })} /> Snooze 30 min</label>
	<DeviceReminders vapidKey={data.vapidKey} bind:problem={deviceProblem} />
	{#if deviceProblem}<p class="error meta" role="alert">{deviceProblem}</p>{/if}
{/snippet}

{#snippet identityPart()}
	<p class="muted">Who does this habit make you? Identities shows what stands for each.</p>
	{#if identities.length}
		<div class="chips">
			{#each identities as i (i.id)}
				<button type="button" class="toggle" aria-pressed={h.identityIds.includes(i.id)} onclick={() => toggleIdentity(i.id)}
					>{i.statement}</button
				>
			{/each}
		</div>
	{/if}
	<div class="row">
		<input class="grow" bind:value={newIdentity} placeholder="I am a runner" aria-label="New identity"
			onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), newIdentity.trim() && createIdentity())} />
		<button type="button" onclick={createIdentity} disabled={!newIdentity.trim()}>Add</button>
	</div>
	{#if identityError}<p class="error">{identityError}</p>{/if}
{/snippet}

{#snippet typePart()}
	{@const type = h.direction === 'break' ? 'break' : h.scoring === 'track' ? 'track' : 'build'}
	<!-- A tracker is judged by nothing, so it can't be a group, hold habits or sit in one (rules T1, checkLinks). -->
	{@const noTrack = isGroupKind ? 'A group is judged by the habits inside it, so it can’t be a tracker' : isRoutine ? 'It holds habits, and a tracker counts nothing for them' : h.parentId ? 'Take it out of its group or routine first' : ''}
	<fieldset class="card">
		<legend class="muted">Type</legend>
		<label style="color: var(--ink)"
			><input type="radio" name="type" checked={type === 'build'} onchange={() => ((h.direction = 'build'), (h.scoring = 'habit'))} disabled={!!directionLocked && h.direction !== 'build'} /> Build: something to do</label
		>
		<label style="color: var(--ink)"
			><input type="radio" name="type" checked={type === 'track'} onchange={() => ((h.direction = 'build'), (h.scoring = 'track'))} disabled={(!!directionLocked && h.direction !== 'build') || (!!noTrack && type !== 'track')} /> Track: just keep a log,
			nothing done or missed</label
		>
		<label style="color: var(--ink)"
			><input type="radio" name="type" checked={type === 'break'} onchange={() => ((h.direction = 'break'), (h.scoring = 'habit'))} disabled={!!directionLocked && h.direction !== 'break'} /> Break: something to stop, with
			a slip counter</label
		>
		{#if directionLocked}<p class="muted meta" style="margin: 0.25rem 0 0">{directionLocked}.</p>{/if}
		{#if noTrack && type !== 'track' && type !== 'break'}<p class="muted meta" style="margin: 0.25rem 0 0">Track: {noTrack.charAt(0).toLowerCase() + noTrack.slice(1)}.</p>{/if}
	</fieldset>
{/snippet}

{#snippet areaPart()}
	{#if data.areas.length}
		<div>
			<span class="muted meta">Area</span>
			<div class="chips">
				<button type="button" class="toggle" aria-pressed={!h.areaId} onclick={() => (h.areaId = null)}>None</button>
				{#each data.areas as a (a.id)}
					<button type="button" class="toggle" aria-pressed={h.areaId === a.id} onclick={() => (h.areaId = a.id)}>{a.icon} {a.name}</button>
				{/each}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet insidePart()}
	{#if h.direction === 'build' && (data.groups.length || h.parentId)}
		{@const groupsOnly = data.groups.filter((g) => !g.routine)}
		<!-- A group is judged, never marked, so it can't sit in a routine (whose Done marks what is inside). -->
		{@const routines = kind === 'group' ? [] : data.groups.filter((g) => g.routine)}
		<label
			>Inside
			<select bind:value={h.parentId}>
				<option value={null}>Not inside another habit</option>
				{#if groupsOnly.length}
					<optgroup label="Groups">
						{#each groupsOnly as g (g.id)}<option value={g.id}>{g.name}{g.archived ? ' (archived)' : ''}</option>{/each}
					</optgroup>
				{/if}
				{#if routines.length}
					<optgroup label="Routines (habits with no Tasks of their own)">
						{#each routines as g (g.id)}<option value={g.id}>{g.name}{g.archived ? ' (archived)' : ''}</option>{/each}
					</optgroup>
				{/if}
			</select>
		</label>
		{#if parent}
			<p class="muted meta" style="margin-top: -0.25rem">
				{#if parent.routine}
					On Today it shows inside {parent.name}, and {parent.name}'s days count it. Under How often it can follow {parent.name}'s days.
				{:else}
					On Today it shows inside its group, and the group's days count it.
				{/if}
			</p>
		{/if}
	{/if}
{/snippet}

{#snippet insteadPart()}
	<p class="meta">Decide now what you'll do when the urge comes, so you have something to do instead.</p>
	<div class="row">
		<label class="grow">If I <input bind:value={h.ifThen.when} placeholder="want a cigarette" /></label>
		<label class="grow">then I will <input bind:value={h.ifThen.then} placeholder="do 10 push-ups" /></label>
	</div>
	{#if buildHabits.length}
		<label
			>Or do one of your habits instead
			<select
				value={h.ifThen.habitId ?? ''}
				onchange={(e) => (h.ifThen.habitId = e.currentTarget.value || null)}
			>
				<option value="">None</option>
				{#each buildHabits as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
			</select>
		</label>
	{/if}
{/snippet}

{#snippet feelingsPart()}
	<p class="meta">Feelings you can pick when you log a slip. Over time Today shows which ones come up most.</p>
	<OptionList
		bind:options={h.triggers}
		used={(id) => data.usedFeelings.includes(id)}
		label="Feeling"
		addLabel="Add feeling"
		placeholder="e.g. Stressed"
		usedTitle="Past slips were logged with it: they keep it, and a rename shows there too"
	/>

{/snippet}

{#snippet costPart()}
	{#if h.cost}
		<div class="row">
			<label style="width: 7rem">Cost per slip <input type="number" min="0" step="any" bind:value={h.cost.amount} /></label>
			<label style="width: 6rem">Unit <input bind:value={h.cost.unit} placeholder="€, kcal, min" /></label>
			<label class="grow"
				>Slips a day before you started
				<input type="number" min="0" step="any" value={h.cost.perDay ?? ''}
					oninput={(e) => h.cost && (h.cost.perDay = numOrNull(e.currentTarget.value))} placeholder="optional, e.g. 10" />
			</label>
		</div>
	{/if}
{/snippet}

{#snippet limitPart()}
	<p class="meta">{h.limit ? 'Log each one as it happens; the counter shows how many days in a row you stayed within the limit.' : 'The habit shows the days since your last slip. To cut down instead of quitting, set a limit.'}</p>
	<label style="color: var(--ink)"
		><input
			type="checkbox"
			checked={!!h.limit}
			onchange={(e) =>
				(h.limit = e.currentTarget.checked
					? { max: 3, period: 'day', taper: null, start: h.startDate }
					: null)}
		/> Allow up to a limit; the counter tracks days within it</label
	>
	{#if h.limit}
		<div class="row">
			<label style="width: 6rem">Up to <input type="number" min="0" max="1000" bind:value={h.limit.max} /></label>
			<label class="grow"
				>Per
				<select bind:value={h.limit.period}>
					<option value="day">day</option>
					<option value="week">week</option>
				</select>
			</label>
		</div>
		<label style="color: var(--ink)"
			><input
				type="checkbox"
				checked={!!h.limit.taper}
				onchange={(e) => h.limit && (h.limit.taper = e.currentTarget.checked ? { by: 1, every: 'week', floor: 0 } : null)}
			/> Lower the limit over time</label
		>
		{#if h.limit.taper}
			<div class="row">
				<label style="width: 6rem">By <input type="number" min="1" max="100" bind:value={h.limit.taper.by} /></label>
				<label class="grow"
					>Every
					<select bind:value={h.limit.taper.every}>
						<option value="week">week</option>
						<option value="month">month</option>
					</select>
				</label>
				<label style="width: 7rem">Down to <input type="number" min="0" max="1000" bind:value={h.limit.taper.floor} /></label>
			</div>
		{/if}
		{#if limitPreview}<p class="muted meta">{limitPreview}</p>{/if}
	{/if}
{/snippet}

{#snippet startField()}
	<label>{h.direction === 'break' ? 'Counting from' : 'Started on'} <input type="date" value={h.startDate} onchange={(e) => (h.direction === 'break' ? e.currentTarget.value && (h.startDate = e.currentTarget.value) : setStart(e.currentTarget.value))} required /></label>
	<p class="meta">
		Days from here on can be logged. {h.startDate > data.today ? 'Nothing is due before then.' : scored && h.startDate < data.today && h.startDate !== savedStart ? 'Due days you leave unlogged count as missed, unless you change that under Streak.' : ''}
	</p>
{/snippet}

{#snippet appliesQuestion()}
	{#if scheduleEdited}
		<div class="stack" role="radiogroup" aria-label="Which days this change is for">
			<label class="check"><input type="radio" class="choice" bind:group={scheduleApplies} value="today" /> <span>From today on <span class="meta">Earlier days keep the plan they had.</span></span></label>
			<label class="check"><input type="radio" class="choice" bind:group={scheduleApplies} value="past" /> <span>To past days too <span class="meta">Missed days are counted again. Everything you logged stays.</span></span></label>
		</div>
	{/if}
{/snippet}

{#snippet moveQuestion()}
	{#if movedIn}
		<div class="stack" role="radiogroup" aria-label="Which days it counts in {parent?.name}">
			<label class="check"><input type="radio" class="choice" bind:group={moveApplies} value="today" /> <span>From today on <span class="meta">The days before keep where it was.</span></span></label>
			<label class="check"
				><input type="radio" class="choice" bind:group={moveApplies} value="past" />
				<span>Past days too <span class="meta">Its days from {shortDate(savedStart)} count in {parent?.name}.{parent && !parent.routine && parent.startDate > savedStart ? ` ${parent.name}'s Started on moves back to ${shortDate(savedStart)}.` : ''}</span></span></label
			>
		</div>
	{/if}
{/snippet}

{#snippet levelsPart()}
			<label style="color: var(--ink)"
				><input type="checkbox" bind:checked={h.levels.enabled} /> Use levels: a two-minute Minimum, your Target, and a Stretch</label
			>
			{#if h.levels.enabled}
				<label>Minimum <input bind:value={h.levels.minimum} placeholder="Put on running shoes" /></label>
				<label>Target <input bind:value={h.levels.target} placeholder="Run 5 km" /></label>
				<label>Stretch <input bind:value={h.levels.stretch} placeholder="Run 10 km" /></label>
				<p class="muted meta">Set numbers for each level per Task in the Slots above. Whether a Minimum day counts is under Streak.</p>
			{/if}
{/snippet}

{#snippet streakPart()}
			<label
				>How the streak counts
				<select value={h.streakRule.kind} onchange={(e) => setRule(e.currentTarget.value as HabitForm['streakRule']['kind'])}>
					<option value="neverTwice">Never miss twice: one miss is forgiven</option>
					<option value="strict">Strict: any miss resets it</option>
					<option value="grace">Grace days: a few misses allowed</option>
					<option value="consistency">Consistency: % done, no streak</option>
				</select>
			</label>
			{#if h.streakRule.kind === 'grace'}
				<div class="row">
					<label style="width: 6rem">Misses <input type="number" min="1" max="15" bind:value={h.streakRule.misses} /></label>
					<label class="grow"
						>Per
						<select bind:value={h.streakRule.period}>
							<option value="week">week</option>
							<option value="month">month</option>
						</select>
					</label>
				</div>
			{:else if h.streakRule.kind === 'consistency'}
				<label style="width: 10rem">Over the last N days <input type="number" min="7" max="365" bind:value={h.streakRule.days} /></label>
			{/if}
			{#if h.direction === 'build' && (kind !== 'group' || groupMinimum !== null)}
				<fieldset class="card">
					<legend class="muted">A day that falls short of the target</legend>
					<label style="color: var(--ink)"
						><input type="radio" bind:group={h.minimumCounts} value={true} />
						{kind === 'group' ? `Counts once ${groupMinimum} inside are done` : h.levels.enabled ? 'Counts once it reaches the Minimum' : 'Counts once anything is logged'}</label
					>
					<label style="color: var(--ink)"
						><input type="radio" bind:group={h.minimumCounts} value={false} /> Only the full target counts</label
					>
					<p class="muted meta" style="margin: 0.25rem 0 0" hidden={kind === 'group'}>
						{h.minimumCounts
							? h.levels.enabled
								? 'Doing the Minimum keeps the streak alive. Less than that is a miss once the day is over.'
								: '5 of 6 glasses is a done day, shown as "Done · 5 of 6 glasses".'
							: 'Good for medication: 1 of 2 doses is a miss once the day is over, shown as "Missed · 1 of 2 steps".'}
						What you logged always stays in History and Stats.
					</p>
				</fieldset>
			{/if}
			{#if kind !== 'group'}
			<fieldset class="card">
				<legend class="muted">Days you don't log</legend>
				<label style="color: var(--ink)"
					><input type="radio" bind:group={h.unlogged} value="missed" /> Count as missed once the day is over</label
				>
				<label style="color: var(--ink)"
					><input type="radio" bind:group={h.unlogged} value="ignore" /> Don't count them: only what you log counts</label
				>
				<p class="muted meta" style="margin: 0.25rem 0 0">
					{h.unlogged === 'ignore'
						? 'A day you forget leaves your streak and consistency as they were. Logging it later still counts.'
						: 'Streaks, consistency, the chain and Stats treat a forgotten day as a miss. Log or skip it later to change that.'}
				</p>
			</fieldset>
			{/if}
{/snippet}

{#snippet treatPart()}
		<label
			>Pair with
			<input bind:value={h.bundle.reward} placeholder="my favourite podcast" />
		</label>
		{#if h.bundle.reward}
			<label style="color: var(--ink)"
				><input type="checkbox" bind:checked={h.bundle.strict} /> Save it as a treat for after the habit is done</label
			>
		{/if}
{/snippet}

{#snippet prepPart()}
		<p class="muted">Steps that make tomorrow easier. They show on Today the day before this habit is due.</p>
		{#each h.prep as item, pi (item)}
			<div class="row">
				<span class="grow">{item}</span>
				<button type="button" class="quiet" onclick={() => h.prep.splice(pi, 1)}>Remove</button>
			</div>
		{/each}
		<div class="row">
			<input class="grow" bind:value={newPrep} placeholder="Lay out gym clothes" aria-label="New prep step"
				onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addPrep())} />
			<button type="button" onclick={addPrep}>Add</button>
		</div>
{/snippet}

{#snippet rewardPart()}
		<label style="color: var(--ink)"
			><input type="checkbox" bind:checked={h.reward.celebrate} /> Celebrate when I finish</label
		>
		{#if h.reward.celebrate}
			<label>Message <input bind:value={h.reward.message} placeholder="What you want to hear when it is done" /></label>
		{/if}
		<!-- A jar fills when a day is done, and a tracker's days never are (rule T2). -->
		<label style="color: var(--ink)" hidden={tracker}
			><input
				type="checkbox"
				checked={!!h.reward.jar}
				onchange={(e) => (h.reward.jar = e.currentTarget.checked ? { amount: 2, unit: '€', goal: '' } : null)}
			/> Fill a jar toward a reward</label
		>
		{#if h.reward.jar && !tracker}
			<div class="row">
				<label style="width: 7rem">Each time, add <input type="number" min="0" step="any" bind:value={h.reward.jar.amount} /></label>
				<label style="width: 5rem">Unit <input bind:value={h.reward.jar.unit} placeholder="€, points" /></label>
				<label class="grow">Saving for <input bind:value={h.reward.jar.goal} placeholder="new running shoes" /></label>
			</div>
			<p class="muted meta">A pretend jar that fills up as you go. Treat yourself when it's full.</p>
		{/if}
{/snippet}

{#snippet raisePart()}
			{#if h.progression}
				<div class="row">
					<label style="width: 8rem">After hitting them <input type="number" min="2" max="60" bind:value={h.progression.after} /></label>
					<span style="padding-bottom: 0.6rem">times in a row, raise by</span>
					<label style="width: 5rem"><input type="number" min="0" step="any" bind:value={h.progression.by} aria-label="Raise by" /></label>
					<label style="width: 7rem"
						><select bind:value={h.progression.unit} aria-label="Raise unit">
							<option value="percent">%</option>
							<option value="steps">steps</option>
						</select></label
					>
				</div>
				{#if h.progression.unit === 'steps'}
					<p class="muted meta">
						A step is each field's own +/− step, in its own unit{raiseLines.length ? `: ${raiseLines.join(', ')}` : ''}. Change a step in the Task's “When logging”.
					</p>
				{/if}
				<p class="muted meta">ittracks only suggests it. Nothing changes until you accept.</p>
			{/if}
{/snippet}

{#snippet reframePart()}
	<label
		>A line to see on the card
		<input bind:value={h.reframe} placeholder={h.direction === 'break' ? 'I am free of this' : 'I get to do this today'} />
	</label>
{/snippet}

{#snippet line(id: string, body: Snippet, o: { lead?: boolean; question?: Snippet; effect?: string } = {})}
	{@const l = LINES[id]}
	<SaidLine
		{id}
		label={l.label}
		words={now[id] || 'Nothing yet.'}
		lead={o.lead}
		bind:open={() => !!opened[id], (v) => (opened[id] = v)}
		held={holds(id)}
		was={before[id]}
		effect={o.effect ?? l.effect ?? ''}
		saving={saving[id]}
		problem={problems[id]}
		onsave={() => saveLine(id, appliesOf(id))}
		oncancel={() => cancelLine(id)}
		onremove={optional[id] ? () => remove(id) : undefined}
		question={o.question}
	>
		{@render body()}
	</SaidLine>
{/snippet}

{#snippet whatSection()}
	{@render whatYouDo()}
	{#if problems.what}<p class="error meta" role="alert">{problems.what}</p>{/if}
{/snippet}
{#snippet countsSection()}
	<div class="card su-lines">
		{#if shows('levels')}{@render line('levels', levelsPart)}{/if}
		{#if shows('streak')}{@render line('streak', streakPart)}{/if}
		{#if shows('quick')}{@render line('quick', quickPart)}{/if}
		{#if shows('raise')}{@render line('raise', raisePart)}{/if}
	</div>
{/snippet}
{#snippet slipSection()}
	<div class="card su-lines">
		{@render line('feelings', feelingsPart)}
		{#if shows('cost')}{@render line('cost', costPart)}{/if}
	</div>
{/snippet}
{#snippet keepsSection()}
	<div class="card su-lines">
		{#if shows('identity')}{@render line('identity', identityPart)}{/if}
		{#if shows('treat')}{@render line('treat', treatPart)}{/if}
		{#if shows('reward')}{@render line('reward', rewardPart)}{/if}
		{#if shows('prep')}{@render line('prep', prepPart)}{/if}
		{#if shows('reframe')}{@render line('reframe', reframePart)}{/if}
	</div>
{/snippet}
{#snippet aboutSection()}
	<div class="card su-lines">
		{#if shows('notes')}{@render line('notes', notesPart)}{/if}
		{#if data.areas.length}{@render line('area', areaPart)}{/if}
		{#if shows('inside')}{@render line('inside', insidePart, { question: moveQuestion, effect: movedIn && moveApplies === 'past' ? `Its past days count in ${parent?.name} too.` : undefined })}{/if}
		{@render line('started', startField, { question: appliesQuestion })}
		{@render line('kind', typePart)}
	</div>
{/snippet}

{#snippet startToggles()}
	<div class="chips">{#each startLines as id (id)}<button type="button" class="toggle" aria-pressed={!!data.newLines[pageKind]?.includes(id)} onclick={() => startWith(id)}>{optional[id].word}</button>{/each}</div>
	<p class="meta muted">These lines are there from the start on every {KINDS[pageKind]} you make. The rest come with their + button.</p>
{/snippet}

{#snippet lines()}
	<div class="card su-lines">
		{@render line('name', namePart, { lead: true })}
		{#if build}
			{@render line('days', schedulePart, { question: appliesQuestion })}
		{:else}
			{@render line('limit', limitPart)}
		{/if}
		{#if shows('when')}{@render line('when', cuePart)}{/if}
		{#if shows('remind')}{@render line('remind', remindPart)}{/if}
		{#if shows('instead')}{@render line('instead', insteadPart)}{/if}
	</div>

	<EditableList items={sections} key={(x) => x} label={sectionTitle} mode={arranging} layout="bare" class="sections" ariaLabel="Sections" onmove={(m, order) => moveSection(m.key as Section, order as Section[])}>
		{#snippet row(x, ctx)}
			<GroupHeading title={sectionTitle(x)} mode={arranging} grip={ctx.grip} />
			<div>{@render { what: whatSection, counts: countsSection, slip: slipSection, keeps: keepsSection, about: aboutSection }[x]()}</div>
		{/snippet}
	</EditableList>

	{#if toAdd.length}
		<div class="chips add-more" role="group" aria-label="Add to this habit">
			{#each morePills ? toAdd : toAdd.slice(0, 6) as id (id)}<button type="button" onclick={() => add(id)}>+ {optional[id].word}</button>{/each}
			{#if toAdd.length > 6 && !morePills}<button type="button" onclick={() => (morePills = true)}>More…</button>{/if}
		</div>
	{/if}

	{#if arranging === 'edit'}
		<div class="field new-lines" role="group" aria-labelledby="new-lines-l">
			<span class="label" id="new-lines-l">On every new {KINDS[pageKind]}</span>
			{@render startToggles()}
		</div>
	{:else if data.isNew && mode === 'full'}
		<details class="new-lines">
			<summary class="meta">On every new {KINDS[pageKind]}</summary>
			{@render startToggles()}
		</details>
	{/if}

	{#each uniq(ruleCheck.errors.map((i) => i.reason)) as reason (reason)}<p class="error">{reason}</p>{/each}
	{#each uniq(ruleCheck.warnings.map((i) => i.reason)) as reason (reason)}<p class="meta">Heads up: {reason}</p>{/each}
{/snippet}

{#snippet namePart()}
	<label class="label" for="habit-name">Name</label>
	<input id="habit-name" bind:value={h.name} placeholder="Gym, Read, Spanish" maxlength="120" required />
{/snippet}
{#snippet quickPart()}
	<label class="check"><input type="checkbox" class="pick" bind:checked={h.quickDone} /> One-tap Done on Today (logs your targets)</label>
{/snippet}
{#snippet notesPart()}
	<NoteBox bind:value={h.notes} label="Notes" hint="Markdown: why this habit matters, the plan, links." />
{/snippet}

{#if mode === 'choose'}
	<header class="bar">
		<h1>New habit</h1>
		<a href="/habits">Cancel</a>
	</header>
	<p class="muted">How do you want to start?</p>
	<ul class="list">
		<li><a class="card" href="/gallery"><strong>Pick a ready-made habit</strong><div class="muted meta">Gym plans, language practice, reading, quitting smoking and more. Adjust it after.</div></a></li>
		<li><a class="card" href="?mode=guided{data.habit.areaId ? `&area=${data.habit.areaId}` : ''}"><strong>Build it step by step</strong><div class="muted meta">Four short steps: what you do, which days, when, and a check.</div></a></li>
		{#if data.habits.length}
			<li class="card">
				<strong>Copy one of my habits</strong>
				<div class="chips">
					{#each data.habits as x (x.id)}<a class="toggle" href="?from={x.id}">{x.name}</a>{/each}
				</div>
			</li>
		{/if}
		<li><a class="card" href="?mode=full"><strong>Start blank in the full editor</strong><div class="muted meta">Every option on one page.</div></a></li>
		{#if !data.hidden.includes('journal')}
			<li><a class="card" href="/journal?setup"><strong>Start a daily journal</strong><div class="muted meta">A few lines each evening with a prompt, a mood to chart, and an optional day note on Today.</div></a></li>
		{/if}
	</ul>
	<p class="muted meta">You can skip this choice in <a href="/settings#newhabits">Settings</a>.</p>
{:else}
<EditChrome
	title={data.isNew ? (data.copiedFrom ? `Copy of ${data.copiedFrom}` : 'New habit') : h.name || 'Habit'}
	back={{ href: '/habits', label: 'Habits' }}
	bind:mode={arranging}
	modes={data.isNew ? ['use'] : ['use', 'edit']}
	onreset={data.isNew ? undefined : () => void arrange(undefined, `Reset the order of sections, ${everyOne}.`)}
	atDefault={!data.detail[pageKind]}
	hints={data.isNew ? {} : { edit: `Drag ⠿ to move a section, ${everyOne}.`,  use: `${now.days && build ? now.days : now.limit} ${heldIds.length ? 'A change isn’t saved yet.' : ''}`.trim() }}
	more={menu}
/>
{#if !data.isNew}<RecordTabs habit={data.id} at="details" />{/if}

{#if data.archived}
	<form method="POST" action="?/unarchive" class="notice" use:enhance>
		<span class="notice-text">{data.deleteAfter ? `Deleted. It goes for good with its logs on ${goneAt(data.deleteAfter)}.` : 'This habit is archived: hidden from Today, with its history kept.'}</span>
		<span class="notice-acts"><button class="quiet">{data.deleteAfter ? 'Put back' : 'Unarchive'}</button></span>
	</form>
{/if}
{#if elsewhere}
	<div class="notice" data-tone="warn" role="alert">
		<span class="notice-text">{LINES[elsewhere.id].label} changed on another device{Object.keys(elsewhere.moved).length ? `: ${say({ ...base, ...elsewhere.moved } as HabitForm)[elsewhere.id] ?? ''}` : ''}. Yours isn't saved.</span>
		<span class="notice-acts"><button type="button" class="quiet" onclick={showTheirs}>Show it</button><button type="button" class="quiet" onclick={keepMine}>Keep mine</button></span>
	</div>
{/if}
{#if cameBack && heldIds.length}
	<div class="notice"><span class="notice-text">Your change from {cameBack} is back. It isn't saved yet.</span><span class="notice-acts"><button type="button" class="quiet" onclick={() => (forgetHeld(), onreset())}>Discard</button></span></div>
{/if}
{#if data.fixed.length}
	<div class="notice"><span class="notice-text">Some options on this habit blocked each other, so they read differently here: {data.fixed.join('; ')}.</span></div>
{/if}

{#if !data.isNew}
	{@render lines()}
	{#if build && !isGroupKind}
		<label class="check pin"><input type="checkbox" class="pick" checked={pinned} onchange={(e) => setPinned(e.currentTarget.checked)} /> In the app icon's menu (long-press the icon)</label>
		<p class="meta">Quick link for bookmarks or a QR code: <a href="/q/{data.id}">/q/{data.id.slice(0, 8)}…</a>. Add <code>?go=1</code> to log “same as last time” in one tap.</p>
	{/if}
{:else}
<form method="POST" action="?/save" class="stack" id="habit-form" use:enhance={keepOnError}>
	<input type="hidden" name="payload" value={payload} />

	{#if mode === 'guided'}
		<ol class="steps" aria-label="Steps">
			{#each guidedSteps as g, gi (g)}
				<li class:on={gi === step} class:done={gi < step}><button type="button" class="link" onclick={() => (step = gi)} disabled={gi > step && !canNext}>{gi + 1}. {g}</button></li>
			{/each}
		</ol>

		{#if step === 0}
			<label>What's the habit called? <input bind:value={h.name} placeholder="Gym, Spanish, Read" maxlength="120" required /></label>
			{@render typePart()}
			{@render areaPart()}
			{@render insidePart()}
			{#if h.direction === 'build'}
				<h2>What you do</h2>
				<p class="muted meta">Add the Tasks you log, like exercises or "new words". Leave it empty for a simple tick-off habit.</p>
				{@render whatYouDo()}
			{:else}
				{@render startField()}
				{@render insteadPart()}
				{@render feelingsPart()}
				{@render limitPart()}
			{/if}
		{:else if step === 1}
			{#if h.direction === 'build'}
				<h2>Which days?</h2>
				{@render schedulePart()}
			{:else}
				<p class="muted">Break habits are tracked every day, so there's no schedule to set.</p>
			{/if}
		{:else if step === 2}
			<h2>When and where</h2>
			<p class="muted">Optional. A clear time and place make a habit easier to start.</p>
			{@render cuePart()}
			{@render remindPart()}
		{:else}
			<h2>Check</h2>
			<div class="card stack">
				<div><strong>{h.name || 'Unnamed habit'}</strong> · {h.direction === 'break' ? 'Break habit' : describeSchedule(schedule, undefined, h.variants)}</div>
				{#if h.direction === 'build'}
					<div class="muted meta">
						{h.variants.flatMap((v) => v.slots).length
							? h.variants.flatMap((v) => v.slots.map((x) => (x.fillRule ? 'auto-filled' : tasks.find((t) => t.id === x.taskId)?.name))).filter(Boolean).join(', ')
							: 'Nothing to fill in: just tick it off'}
					</div>
				{/if}
				{#if intention}<div class="intention">{intention}</div>{/if}
				<div class="muted meta">Streak: never miss twice (one miss is forgiven). Levels, identity and more are in the full editor any time.</div>
			</div>
			<label style="color: var(--ink)"><input type="checkbox" bind:checked={pinned} /> Add to home screen shortcuts</label>
		{/if}

		{#if form?.error}<p class="error save-error" role="alert">{form.error}</p>{/if}
		<div class="actions-bar l-stack">
			<div class="l-cluster">
				{#if step < guidedSteps.length - 1}
					<button type="button" class="primary" onclick={() => step++} disabled={!canNext}>Next</button>
				{:else}
					<button class="primary">Save habit</button>
				{/if}
				{#if step > 0}<button type="button" onclick={() => step--}>Back</button>{/if}
			</div>
		</div>
		<p class="muted meta"><button type="button" class="link" onclick={() => (mode = 'full')}>Skip to the full editor</button></p>
	{:else}
		{@render lines()}
		{#if form?.error}<p class="error save-error" role="alert">{form.error}</p>{/if}
		<div class="actions-bar l-stack">
			<div class="l-cluster">
				<button class="primary">Save habit</button>
				<a class="button" href="/habits">Cancel</a>
			</div>
		</div>
	{/if}
</form>
{/if}

{#if !data.isNew && h.direction === 'build' && mode === 'full'}
	<GroupHeading title="Pauses" />
	<section class="card stack" id="pause">
		<p class="muted meta">Paused days aren't due and never break the streak. For a break from every habit, use <a href="/settings#vacation">Vacation</a> in Settings.</p>
		{#each data.pauses as p (p.id)}
			<form method="POST" action="?/unpause" class="row" style="align-items: center" use:enhance>
				<input type="hidden" name="id" value={p.id} />
				<span class="grow">{shortDate(p.start)} to {shortDate(p.end)}{p.note ? ` · ${p.note}` : ''}{p.end < data.today ? ' (past)' : ''}</span>
				<button class="quiet">Remove</button>
			</form>
		{/each}
		<form method="POST" action="?/pause" class="row" use:enhance>
			<label class="grow">From <input type="date" name="start" value={data.today} required /></label>
			<label class="grow">To <input type="date" name="end" value={data.today} min={data.today} required /></label>
			<label class="grow">Note <input name="note" placeholder="optional" /></label>
			<button>Pause</button>
		</form>
		{#if form?.pauseError}<p class="error">{form.pauseError}</p>{/if}
	</section>
{/if}
{/if}

<style>
	p {
		margin: 0;
	}
	/* Sections stand apart as their headings did on the page itself. */
	.new-lines {
		margin-block-start: var(--space-section);
	}
	:global(.elist.sections) {
		--gap: var(--space-section);
		margin-block-start: var(--space-section);
	}
	fieldset {
		border: 1px solid var(--line);
		border-radius: var(--radius-inset);
	}
	.lead {
		margin-block-end: var(--space-inline);
	}
	.blocked,
	.pin {
		margin-block: var(--space-group) var(--space-inline);
	}
	.add-more {
		margin-block: var(--space-section) var(--space-group);
	}
	.variant {
		margin-block-end: var(--space-inline);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
	}
	.variant > .card {
		display: flex;
		gap: var(--space-inline);
		align-items: center;
		border: 0;
		border-bottom: 1px solid var(--line);
		border-radius: var(--radius-card) var(--radius-card) 0 0;
	}
	.variant > .card > .content {
		flex: 1;
	}
	.variant > .card > .verb {
		position: relative;
	}
	.variant > .shelf:first-child {
		border-radius: calc(var(--radius-card) - 1px);
	}
	.su-slot {
		padding: var(--space-inline) var(--space-group);
	}
	.su-slot-head {
		display: flex;
		align-items: center;
		gap: var(--space-inline);
		min-height: var(--target-min);
	}
	.su-slot-head .grow {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		font-weight: 600;
	}
	.su-slot-head .slot {
		width: var(--handle-slot);
		display: flex;
	}
	.su-slot-words,
	.su-slot-body {
		margin-inline-start: calc(var(--handle-slot) + var(--space-inline));
	}
	.su-slot-body {
		padding-block: var(--space-inline);
	}
	.su-slot-add {
		padding: var(--space-inline) var(--space-group);
	}
	.intention {
		font-style: italic;
		margin: 0.25rem 0;
	}
	.targets {
		width: 100%;
		border-collapse: collapse;
	}
	.targets th {
		text-align: left;
		font-size: var(--font-size-chip);
		color: var(--ink-muted);
		font-weight: 500;
	}
	.targets td {
		padding: 0.15rem 0.25rem 0.15rem 0;
		font-size: var(--font-size-label);
	}
	.steps {
		display: flex;
		gap: 0.75rem;
		list-style: none;
		padding: 0;
		margin: 0 0 0.5rem;
		flex-wrap: wrap;
	}
	.steps li button {
		color: var(--ink-muted);
	}
	.steps li.on button {
		color: var(--ink);
		font-weight: 600;
	}
	.newtask {
		border-color: var(--accent);
	}
</style>
