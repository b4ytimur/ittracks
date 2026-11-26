<script lang="ts">
	// Automatic backups: how often, where and how many, each saved as it is left, with Undo.
	import { invalidateAll } from '$app/navigation';
	import { BACKUP_EVERY, KEEP_MAX, KEEP_MIN, nextBackup, type BackupPlan, type BackupState } from '$lib/backups';
	import { runAction, showToast } from '$lib/toast.svelte';

	let {
		plan,
		last,
		container,
		problem = $bindable('')
	}: {
		plan: BackupPlan;
		/** What the last copies did. */
		last: BackupState;
		/** The server runs in Docker, where only a mounted folder outlives a rebuild. */
		container: boolean;
		problem?: string;
	} = $props();

	type Change = { was: Partial<BackupPlan>; now: Partial<BackupPlan> };
	const send = (set: Partial<BackupPlan>, was: Partial<BackupPlan>) => runAction<Change>('/settings?/backupPlan', { set: JSON.stringify(set), was: JSON.stringify(was) });

	/** Save it and say so. A value that can't be saved stays where it was typed, and the line says why. */
	async function change(set: Partial<BackupPlan>, said: string) {
		const was = Object.fromEntries(Object.keys(set).map((k) => [k, plan[k as keyof BackupPlan]])) as Partial<BackupPlan>;
		const r = await send(set, was);
		if (!r.ok) {
			problem = r.error ?? 'Not saved. Are you online?';
			// Changed on another device: show it as it is there.
			if (r.error?.includes('another device')) await invalidateAll();
			return;
		}
		problem = '';
		const { was: before, now } = r.data!;
		showToast(said, async () => {
			const u = await send(before, now);
			await invalidateAll();
			return u.ok || (u.error ?? false);
		});
		await invalidateAll();
	}

	const next = $derived(nextBackup(plan, last, new Date()));
	const at = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	const nextWords = $derived(next ? ` Next ${next.getTime() <= Date.now() ? 'within a minute' : `around ${at(next)}`}.` : '');
	function folder(e: FocusEvent & { currentTarget: HTMLInputElement }) {
		const v = e.currentTarget.value.trim();
		if (v && v !== plan.folder) change({ folder: v }, `Backups go to ${v} now.`);
	}
	function keep(e: FocusEvent & { currentTarget: HTMLInputElement }) {
		const n = e.currentTarget.valueAsNumber;
		if (n !== plan.keep) change({ keep: n }, `The newest ${n === 1 ? 'copy stays' : `${n} copies stay`}.`);
	}

	let busy = $state(false);
	async function now() {
		if (busy) return;
		busy = true;
		const r = await runAction<{ made: NonNullable<BackupState['ok']> }>('/settings?/backupNow', {});
		busy = false;
		problem = r.ok ? '' : (r.error ?? 'No copy made. Are you online?');
		if (r.ok) showToast(`Backed up: ${r.data!.made.file}.`);
		await invalidateAll();
	}
</script>

<div class="field">
	<span class="label" id="bk-every">How often</span>
	<div class="chips" role="radiogroup" aria-labelledby="bk-every">
		{#each BACKUP_EVERY as c (c.hours)}
			<label class="toggle"><input type="radio" class="vh" name="bk-every" checked={plan.every === c.hours} onchange={() => change({ every: c.hours }, c.hours ? `Backups: ${c.label.toLowerCase()}.` : 'Automatic backups are off. The copies made so far stay.')} /><span data-reserve={c.label}>{c.label}</span></label>
		{/each}
	</div>
</div>
<div class="field">
	<label class="label" for="bk-folder">Folder on the server</label>
	<p class="field-hint meta" id="bk-folder-h">
		{#if container}The app runs in Docker: <code>/data</code> is the data folder next to docker-compose.yml. Any other folder has to be mounted there first.{:else}A whole path on the computer the app runs on, not on this device.{/if}
	</p>
	<input id="bk-folder" value={plan.folder} spellcheck="false" autocomplete="off" aria-describedby="bk-folder-h" onblur={folder} />
</div>
<div class="field">
	<label class="label" for="bk-keep">Copies to keep</label>
	<input id="bk-keep" type="number" class="short" min={KEEP_MIN} max={KEEP_MAX} step="1" value={plan.keep} onblur={keep} />
</div>
<div class="act-row">
	<span class="status-text meta">{#if last.ok}Newest: <code>{last.ok.file}</code>.{:else}No copy made yet.{/if}{nextWords}</span>
	<button type="button" class="hit" aria-disabled={busy} onclick={now}>Back up now</button>
</div>
<p class="meta">To put a copy back, stop the app, delete <code>ittracks.db-wal</code> and <code>ittracks.db-shm</code> next to the database, and put the copy in place of <code>ittracks.db</code>.</p>

<style>
	p {
		margin: 0;
	}
	.short {
		width: 9rem;
	}
	code {
		overflow-wrap: anywhere;
	}
</style>
