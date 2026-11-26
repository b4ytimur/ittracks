<script lang="ts">
	// A timer for a duration Metric. Stopping it adds the timed minutes to what you logged
	// so far, or replaces a value that was only prefilled (last time's value or the target).
	// The start time is kept in this browser, so the timer survives a reload or screen change.
	import { onMount } from 'svelte';

	let {
		value = $bindable(),
		replace = false,
		target = null,
		storageKey
	}: {
		value: number | null | undefined;
		/** The value is a prefill, not time logged now: the timed minutes take its place. */
		replace?: boolean;
		target?: number | null;
		storageKey: string;
	} = $props();

	type Mode = 'stopwatch' | 'countdown' | 'focus';
	interface Running {
		mode: Mode;
		startedAt: number;
		work: number;
		rest: number;
		rounds: number;
	}

	let running = $state<Running | null>(null);
	let now = $state(Date.now());
	let mode = $state<Mode>('stopwatch');
	let work = $state(25);
	let rest = $state(5);
	let rounds = $state(4);
	let chimed = $state(false);

	const read = (): Running | null => {
		try {
			return JSON.parse(localStorage.getItem(storageKey) ?? 'null');
		} catch {
			return null;
		}
	};
	const write = (r: Running | null) => {
		try {
			if (r) localStorage.setItem(storageKey, JSON.stringify(r));
			else localStorage.removeItem(storageKey);
		} catch {
			// Storage blocked: the timer still works until the page is closed.
		}
	};

	onMount(() => {
		running = read();
		const t = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(t);
	});

	const elapsedMin = $derived(running ? (now - running.startedAt) / 60_000 : 0);

	/** Where a focus block stands: current round, phase, and work minutes done so far. */
	const focus = $derived.by(() => {
		if (!running || running.mode !== 'focus') return null;
		const cycle = running.work + running.rest;
		const total = cycle * running.rounds - running.rest;
		const t = Math.min(elapsedMin, total);
		const round = Math.min(Math.floor(t / cycle), running.rounds - 1);
		const inCycle = t - round * cycle;
		const working = inCycle < running.work;
		const workDone = round * running.work + Math.min(inCycle, running.work);
		const phaseLeft = working ? running.work - inCycle : cycle - inCycle;
		return { round: round + 1, working, workDone, phaseLeft, finished: elapsedMin >= total };
	});

	const countdownLeft = $derived(
		running?.mode === 'countdown' && target ? Math.max(0, target - elapsedMin) : null
	);

	$effect(() => {
		const done = (countdownLeft !== null && countdownLeft <= 0) || focus?.finished;
		if (done && !chimed) {
			chimed = true;
			navigator.vibrate?.([200, 100, 200]);
		}
	});

	function start() {
		running = { mode, startedAt: Date.now(), work, rest, rounds };
		chimed = false;
		write(running);
	}

	function stop() {
		if (!running) return;
		const minutes = running.mode === 'focus' ? (focus?.workDone ?? 0) : elapsedMin;
		value = Math.round(((replace ? 0 : (value ?? 0)) + minutes) * 10) / 10;
		running = null;
		write(null);
	}

	function cancel() {
		running = null;
		write(null);
	}

	const clock = (min: number) => {
		const s = Math.max(0, Math.round(min * 60));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};
</script>

<div class="timer">
	{#if running}
		<div class="face" aria-live="polite">
			{#if running.mode === 'focus' && focus}
				{#if focus.finished}
					Focus block finished
				{:else}
					{focus.working ? 'Work' : 'Break'} · round {focus.round} of {running.rounds} · {clock(focus.phaseLeft)} left
				{/if}
			{:else if countdownLeft !== null}
				{countdownLeft > 0 ? `${clock(countdownLeft)} left` : "Time's up"}
			{:else}
				{clock(elapsedMin)}
			{/if}
		</div>
		<div class="row">
			<button type="button" onclick={stop}>{replace ? 'Stop and use this time' : 'Stop and add time'}</button>
			<button type="button" onclick={cancel}>Cancel</button>
		</div>
	{:else}
		<div class="row">
			<select bind:value={mode} aria-label="Timer mode" style="width: auto">
				<option value="stopwatch">Stopwatch</option>
				{#if target}<option value="countdown">Countdown {target} min</option>{/if}
				<option value="focus">Focus block</option>
			</select>
			{#if mode === 'focus'}
				<label>Work <input class="w-num" type="number" min="1" bind:value={work} /></label>
				<label>Break <input class="w-num" type="number" min="0" bind:value={rest} /></label>
				<label>Rounds <input class="w-num" type="number" min="1" bind:value={rounds} /></label>
			{/if}
			<button type="button" onclick={start}>Start</button>
		</div>
	{/if}
</div>

<style>
	.timer {
		margin-top: var(--space-inline);
	}
	.face {
		font-size: var(--font-size-figure);
		font-variant-numeric: tabular-nums;
		margin-bottom: var(--space-inline);
	}
</style>
