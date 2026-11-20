<script lang="ts">
	import { enhance } from '$app/forms';

	import { onMount, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	let { data, form } = $props();

	let dayStart = $state(untrack(() => data.settings.dayStart ?? '00:00'));
	let ranges = $state(untrack(() => data.settings.ranges.map((r) => ({ ...r }))));
	let areas = $state(untrack(() => data.areas.map((a) => ({ ...a }) as { id: string | null; name: string; color: string; icon: string })));
	function moveArea(i: number, by: number) {
		const j = i + by;
		if (j < 0 || j >= areas.length) return;
		[areas[i], areas[j]] = [areas[j], areas[i]];
	}
	const shortDate = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

	type PushState = 'unsupported' | 'off' | 'on' | 'denied' | 'busy';
	let push = $state<PushState>('busy');
	let pushMessage = $state('');

	const supported = () =>
		'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

	onMount(async () => {
		if (!supported()) return (push = 'unsupported');
		if (Notification.permission === 'denied') return (push = 'denied');
		const reg = await navigator.serviceWorker.getRegistration();
		push = (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
	});

	function keyBytes(base64: string) {
		const b = atob((base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
		return Uint8Array.from(b, (c) => c.charCodeAt(0));
	}

	async function enable() {
		pushMessage = '';
		push = 'busy';
		try {
			if ((await Notification.requestPermission()) !== 'granted') return (push = 'denied');
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: keyBytes(data.vapidKey)
			});
			const res = await fetch('/api/push', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(sub)
			});
			if (!res.ok) throw new Error();
			push = 'on';
			await invalidateAll();
		} catch {
			push = 'off';
			pushMessage = 'Could not turn on reminders in this browser.';
		}
	}

	async function disable() {
		push = 'busy';
		const reg = await navigator.serviceWorker.getRegistration();
		const sub = await reg?.pushManager.getSubscription();
		if (sub) {
			await fetch('/api/push', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ endpoint: sub.endpoint })
			});
			await sub.unsubscribe();
		}
		push = 'off';
		await invalidateAll();
	}
</script>

<svelte:head><title>Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Settings</h1>
	<a href="/history">Back</a>
</header>

<section class="card stack">
	<h2 style="margin-top: 0">Your day</h2>
	<form method="POST" action="?/day" class="stack" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<label style="width: 9rem">Day starts at <input type="time" name="dayStart" bind:value={dayStart} required /></label>
		<p class="muted small-text" style="margin: 0">Logs before this time count for the day before.</p>
		<div>
			<span class="muted small-text">Parts of your day. Habits can be set for a part instead of an exact time, and remind you when it starts.</span>
			{#each ranges as r, i (i)}
				<div class="range">
					<input class="grow" name="rangeName" bind:value={r.name} placeholder="Morning" aria-label="Name" />
					<input type="time" name="rangeStart" bind:value={r.start} aria-label="Starts" />
					<input type="time" name="rangeEnd" bind:value={r.end} aria-label="Ends" />
					<button type="button" class="small" onclick={() => ranges.splice(i, 1)} aria-label="Remove">×</button>
				</div>
			{/each}
			<button type="button" class="small" onclick={() => ranges.push({ name: '', start: '12:00', end: '14:00' })}>+ part</button>
		</div>
		<button>Save</button>
	</form>
	{#if form?.dayError}<p class="error">{form.dayError}</p>{/if}
	{#if form?.daySaved}<p class="muted">Saved.</p>{/if}
</section>

<section class="card stack">
	<h2 style="margin-top: 0">Vacation</h2>
	<p class="muted small-text" style="margin: 0">Pause every habit for a while. Paused days aren't due and never break a streak. Break-habit counters keep running.</p>
	{#each data.vacations as v (v.id)}
		<form method="POST" action="?/unvacation" class="row" style="align-items: center" use:enhance>
			<input type="hidden" name="id" value={v.id} />
			<span class="grow">{shortDate(v.start)} to {shortDate(v.end)}{v.note ? ` · ${v.note}` : ''}{v.end < data.today ? ' (past)' : ''}</span>
			<button class="small">Remove</button>
		</form>
	{/each}
	<form method="POST" action="?/vacation" class="row" use:enhance>
		<label class="grow">From <input type="date" name="start" value={data.today} required /></label>
		<label class="grow">To <input type="date" name="end" value={data.today} min={data.today} required /></label>
		<label class="grow">Note <input name="note" placeholder="optional" /></label>
		<button>Add</button>
	</form>
	{#if form?.vacationError}<p class="error">{form.vacationError}</p>{/if}
</section>

<section class="card stack">
	<h2 style="margin-top: 0">Areas</h2>
	<p class="muted small-text" style="margin: 0">Big groups for habits and Tasks. Deleting one never deletes what's in it.</p>
	{#each areas as a, i (i)}
		<div class="row area-row">
			<input style="width: 3.2rem; text-align: center" bind:value={a.icon} aria-label="Icon" maxlength="8" />
			<input class="grow" bind:value={a.name} aria-label="Name" />
			<select bind:value={a.color} aria-label="Color" style="width: 6.5rem; color: {a.color}">
				{#each data.colors as c (c)}<option value={c} style="color: {c}">● {c}</option>{/each}
			</select>
			<button type="button" class="small" onclick={() => moveArea(i, -1)} aria-label="Move up">↑</button>
			<button type="button" class="small" onclick={() => moveArea(i, 1)} aria-label="Move down">↓</button>
			<button type="button" class="small danger" onclick={() => areas.splice(i, 1)} aria-label="Delete">×</button>
		</div>
	{/each}
	<form method="POST" action="?/areas" class="row" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<input type="hidden" name="areas" value={JSON.stringify(areas)} />
		<button type="button" onclick={() => areas.push({ id: null, name: '', color: data.colors[areas.length % data.colors.length], icon: '' })}>+ Area</button>
		<button>Save Areas</button>
	</form>
	{#if form?.areasError}<p class="error">{form.areasError}</p>{/if}
	{#if form?.areasSaved}<p class="muted">Saved.</p>{/if}
</section>

<section class="card stack">
	<h2 style="margin-top: 0">Display</h2>
	<form method="POST" action="?/display" class="stack" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<label style="color: var(--text)"><input type="checkbox" name="guidedSetup" checked={data.settings.guidedSetup} /> New habits ask how to start (gallery, step by step, copy, or blank)</label>
		<label style="color: var(--text)"><input type="checkbox" name="showAllSections" checked={data.settings.showAllSections} /> Show every section in the habit editor</label>
		<label style="color: var(--text)"><input type="checkbox" name="groupByArea" checked={data.settings.groupByArea} /> Group Today, Habits and the Library by Area</label>
		<button>Save</button>
	</form>
	{#if form?.displaySaved}<p class="muted">Saved.</p>{/if}
</section>

<section class="card stack">
	<h2 style="margin-top: 0">Units</h2>
	<form method="POST" action="?/units" class="row" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<label class="grow"
			>Default weight unit for new Tasks
			<input name="weightUnit" value={data.settings.weightUnit} list="weight-units" />
		</label>
		<button>Save</button>
	</form>
	<datalist id="weight-units"><option value="kg"></option><option value="lb"></option></datalist>
	<p class="muted" style="margin: 0">Each Metric keeps its own unit; you can change it in the Task editor.</p>
	{#if form?.unitsError}<p class="error">{form.unitsError}</p>{/if}
	{#if form?.unitsSaved}<p class="muted">Saved.</p>{/if}
</section>

<section class="card stack">
	<h2 style="margin-top: 0">Reminders</h2>
	<p class="muted" style="margin: 0">
		Habits with a cue time and "Remind me" turned on send a notification at that time, if they are
		due and not done yet. Turn reminders on for each phone or computer you use.
	</p>
	{#if push === 'unsupported'}
		<p class="muted" style="margin: 0">
			This browser can't receive reminders. On iPhone and iPad, add ittracks to your Home Screen first
			(Share, then Add to Home Screen) and open it from there.
		</p>
	{:else if push === 'denied'}
		<p class="muted" style="margin: 0">Notifications are blocked for this site. Allow them in your browser settings.</p>
	{:else}
		<div class="row">
			{#if push === 'on'}
				<span class="grow">On for this device.</span>
				<button onclick={disable}>Turn off</button>
			{:else}
				<span class="grow">{push === 'busy' ? 'Checking…' : 'Off for this device.'}</span>
				<button class="primary" onclick={enable} disabled={push === 'busy'}>Turn on</button>
			{/if}
		</div>
	{/if}
	{#if data.devices}
		<form method="POST" action="?/testReminder" class="row" use:enhance>
			<span class="grow muted">{data.devices} {data.devices === 1 ? 'device' : 'devices'} set up</span>
			<button>Send a test</button>
		</form>
	{/if}
	{#if pushMessage}<p class="error">{pushMessage}</p>{/if}
	{#if form?.pushError}<p class="error">{form.pushError}</p>{/if}
	{#if form?.testSent}<p class="muted">Test sent.</p>{/if}
</section>

<section class="card stack">
	<h2 style="margin-top: 0">Password</h2>
	<p class="muted" style="margin: 0">Signed in as {data.username}.</p>
	<form method="POST" action="?/password" class="stack" use:enhance>
		<label>Current password <input name="current" type="password" autocomplete="current-password" required /></label>
		<label>New password <input name="next" type="password" autocomplete="new-password" minlength="8" required /></label>
		<button>Change password</button>
	</form>
	{#if form?.passwordError}<p class="error">{form.passwordError}</p>{/if}
	{#if form?.passwordSaved}<p class="muted">Password changed.</p>{/if}
</section>

<section class="card stack">
	<h2 style="margin-top: 0">Templates</h2>
	<p class="muted" style="margin: 0">
		Export any habit as a template from its editor. Import templates from the <a href="/habits">Habits</a> tab, or
		pick a ready-made one from the <a href="/gallery">gallery</a>.
	</p>
</section>

<section class="card stack">
	<h2 style="margin-top: 0">Shortcuts</h2>
	<p class="muted small-text" style="margin: 0">
		Every habit has a quick-log link: <code>/q/&lt;habit&gt;</code> opens today's quick log, and <code>/q/&lt;habit&gt;?go=1</code>
		logs "Same as last time" at once. Use them from a bookmark, iOS Shortcuts or an Android launcher. Habits marked
		"Add to home screen shortcuts" show up when you long-press the installed app's icon (reinstall the app to refresh them).
	</p>
</section>

<style>
	.small-text {
		font-size: 0.85rem;
	}
	.range,
	.area-row {
		margin-top: 0.35rem;
		align-items: center;
	}
</style>

<form method="POST" action="/logout" style="margin-top: 1.5rem"><button class="danger">Log out</button></form>
