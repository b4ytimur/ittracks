<script lang="ts">
	import { enhance } from '$app/forms';

	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	let { data, form } = $props();

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
		Export any habit as a template from its editor. Import templates from the <a href="/habits">Habits</a> tab.
	</p>
</section>

<form method="POST" action="/logout" style="margin-top: 1.5rem"><button class="danger">Log out</button></form>
