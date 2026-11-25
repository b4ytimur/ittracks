<script lang="ts">
	// This device's reminders, and whether any device gets them.
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { runAction, showToast } from '$lib/toast.svelte';

	let { vapidKey, devices, problem = $bindable('') }: { vapidKey: string; devices: number; problem?: string } = $props();

	type PushState = 'unsupported' | 'off' | 'on' | 'denied' | 'busy';
	let push = $state<PushState>('busy');
	const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

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
		problem = '';
		push = 'busy';
		try {
			if ((await Notification.requestPermission()) !== 'granted') return (push = 'denied');
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
			const res = await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
			if (!res.ok) throw new Error();
			push = 'on';
			showToast('Reminders are on for this device.', disable);
			await invalidateAll();
		} catch {
			push = 'off';
			problem = 'Could not turn on reminders in this browser.';
		}
	}
	async function disable() {
		push = 'busy';
		const reg = await navigator.serviceWorker.getRegistration();
		const sub = await reg?.pushManager.getSubscription();
		if (sub) {
			await fetch('/api/push', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => null);
			await sub.unsubscribe();
		}
		push = 'off';
		await invalidateAll();
	}
	async function test() {
		const r = await runAction('/settings?/testReminder', {});
		problem = r.ok ? '' : (r.error ?? 'Not sent. Are you online?');
		if (r.ok) showToast('Test sent.');
	}
</script>

{#if push === 'unsupported'}
	<p class="status-text">This browser can't receive reminders. On iPhone and iPad, add ittracks to your Home Screen first (Share, then Add to Home Screen) and open it from there.</p>
{:else if push === 'denied'}
	<p class="status-text">Notifications are blocked for this site. Allow them in your browser's settings for this site, then come back.</p>
{:else}
	<div class="act-row">
		<span class="status-text" role="status">{push === 'on' ? 'On for this device.' : push === 'busy' ? 'Checking…' : 'Off for this device.'}</span>
		{#if push !== 'busy'}<button type="button" class="hit" onclick={push === 'on' ? disable : enable}>{push === 'on' ? 'Turn off' : 'Turn on'}</button>{/if}
	</div>
{/if}
{#if devices}
	<div class="act-row"><span class="status-text">{devices} {devices === 1 ? 'device' : 'devices'} set up.</span><button type="button" class="hit" onclick={test}>Send a test</button></div>
{/if}

<style>
	p {
		margin: 0;
	}
</style>
