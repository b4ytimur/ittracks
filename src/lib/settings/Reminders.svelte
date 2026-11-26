<script lang="ts">
	// This device's reminders, and every habit's.
	import DeviceReminders from './DeviceReminders.svelte';
	import { invalidateAll } from '$app/navigation';
	import { runAction, showToast } from '$lib/toast.svelte';

	let {
		vapidKey,
		devices,
		reminders,
		problem = $bindable('')
	}: {
		vapidKey: string;
		devices: number;
		/** Every habit with a time or a part of the day. */
		reminders: { id: string; name: string; when: string; remind: boolean }[];
		problem?: string;
	} = $props();

	/** The same setting as on the habit's page. */
	async function set(h: (typeof reminders)[number], on: boolean): Promise<boolean> {
		const r = await fetch(`/api/habits/${h.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ set: { remind: on }, was: { remind: !on } }) }).catch(() => null);
		if (!r) problem = 'Not saved. Are you online?';
		else if (!r.ok) problem = (await r.json().catch(() => ({}))).error ?? 'Not saved.';
		else problem = '';
		if (r) await invalidateAll();
		return !!r?.ok;
	}
	async function toggle(h: (typeof reminders)[number]) {
		const on = !h.remind;
		if (await set(h, on)) showToast(on ? `${h.name} reminds you, ${at(h.when)}.` : `${h.name} no longer reminds you.`, () => set({ ...h, remind: on }, !on));
	}
	const at = (w: string) => (/^\d/.test(w) ? `at ${w}` : `when ${w} starts`);
	async function test() {
		const r = await runAction('/settings?/testReminder', {});
		problem = r.ok ? '' : (r.error ?? 'Not sent. Are you online?');
		if (r.ok) showToast('Test sent.');
	}
</script>

<DeviceReminders {vapidKey} bind:problem />
{#if devices}
	<div class="act-row"><span class="status-text">{devices} {devices === 1 ? 'device' : 'devices'} set up.</span><button type="button" onclick={test}>Send a test</button></div>
{/if}

{#if reminders.length}
	<div class="field">
		<span class="label">Habits</span>
		{#each reminders as h (h.id)}
			<div class="act-row"><span class="status-text"><a href="/habits/{h.id}">{h.name}</a> <span class="meta muted">· {at(h.when)}, {h.remind ? 'on' : 'off'}</span></span><button type="button" class="quiet" aria-label="{h.remind ? 'Turn off' : 'Turn on'} the reminder of {h.name}" onclick={() => toggle(h)}>{h.remind ? 'Turn off' : 'Turn on'}</button></div>
		{/each}
	</div>
{:else}<p class="meta muted">A habit can remind you once it has a time or a part of the day, on its page.</p>{/if}

<style>
	p {
		margin: 0;
	}
</style>
