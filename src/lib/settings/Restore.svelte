<script lang="ts">
	// Replacing everything with a backup. Nothing is replaced before what is here has been downloaded.
	import { invalidateAll } from '$app/navigation';
	import { deserialize } from '$app/forms';
	import Ask from '$lib/ui/Ask.svelte';
	import { showToast } from '$lib/toast.svelte';

	let { problem = $bindable('') }: { problem?: string } = $props();

	interface Preview {
		username: string | null;
		exportedAt: string | null;
		includesNotes: boolean;
		counts: Record<string, number>;
	}
	const tables: Record<string, [string, string]> = {
		habit: ['habit', 'habits'],
		task: ['Task', 'Tasks'],
		occurrence: ['habit day', 'habit days'],
		entry: ['logged set or value', 'logged sets and values'],
		slip: ['slip', 'slips'],
		craving: ['craving', 'cravings'],
		dayNote: ['journal day', 'journal days'],
		area: ['Area', 'Areas'],
		identity: ['identity', 'identities']
	};
	const summary = (c: Record<string, number>) =>
		Object.entries(tables)
			.filter(([k]) => c[k])
			.map(([k, [one, many]]) => `${c[k].toLocaleString()} ${c[k] === 1 ? one : many}`)
			.join(', ') || 'nothing';

	let input = $state<HTMLInputElement>();
	let file: File | null = null;
	let preview = $state<Preview | null>(null);
	let busy = $state('');
	let done = $state('');

	async function post<T>(action: string, fields: Record<string, string | File>): Promise<{ data?: T; error?: string }> {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		try {
			const res = await fetch(`/settings?/${action}`, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
			const r = deserialize(await res.text());
			if (r.type === 'success') return { data: r.data as T };
			return { error: (r.type === 'failure' && (r.data as { error?: string })?.error) || 'That did not work. Nothing was changed.' };
		} catch {
			return { error: 'No answer from the server. Are you online, and is the file small enough for it?' };
		}
	}

	async function check() {
		file = input?.files?.[0] ?? null;
		preview = null;
		done = problem = '';
		if (!file) return;
		busy = 'Reading the file…';
		const r = await post<{ preview: Preview }>('preview', { file });
		busy = '';
		if (r.data) preview = r.data.preview;
		else problem = r.error!;
	}

	async function replace() {
		if (!file || busy) return;
		problem = '';
		busy = 'Downloading what is here…';
		try {
			const res = await fetch('/api/v1/export?format=json');
			if (!res.ok) throw new Error();
			const name = /filename="?([^";]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'ittracks-before-restore.json';
			const url = URL.createObjectURL(await res.blob());
			Object.assign(document.createElement('a'), { href: url, download: name }).click();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
		} catch {
			busy = '';
			return void (problem = 'What is here could not be downloaded first, so nothing was replaced.');
		}
		busy = 'Restoring…';
		const r = await post<{ imported: Record<string, number>; renumbered: boolean }>('import', { file, confirm: 'yes' });
		busy = '';
		if (!r.data) return void (problem = r.error!);
		done = `Restored ${summary(r.data.imported)}. What was here before is in your downloads.${r.data.renumbered ? ' Another account on this server had the same ids, so they were renumbered: old quick-log links need updating.' : ''}`;
		preview = file = null;
		if (input) input.value = '';
		showToast('Restored from the backup.');
		await invalidateAll();
	}
</script>

<div class="field"><label class="label" for="restore-file">Backup file</label><input id="restore-file" type="file" accept=".json,application/json" bind:this={input} onchange={check} /></div>
{#if busy}<p class="meta" role="status">{busy}</p>{/if}
{#if done}<p class="meta" role="status">{done}</p>{/if}
{#if preview}
	<div>
		<p class="meta">
			Made{preview.username ? ` by ${preview.username}` : ''}{preview.exportedAt ? ` on ${new Date(preview.exportedAt).toLocaleString()}` : ''}. It holds {summary(preview.counts)}.{preview.includesNotes ? '' : ' It has no notes and no journal.'}
		</p>
		<Ask label="Replace my data" text="Everything in this account is replaced by what is in the file, and this can't be undone here. What is here now is downloaded first, so you can restore that the same way." act="Download it, then replace" keep="Keep what is here" small={false} onact={replace} />
	</div>
{/if}

<style>
	p {
		margin: 0;
	}
	p + :global(button) {
		margin-block-start: var(--space-inline);
	}
</style>
