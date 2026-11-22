<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const tableNames: Record<string, [string, string]> = {
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
	const summary = (counts: Record<string, number>) =>
		Object.entries(tableNames)
			.filter(([k]) => counts[k])
			.map(([k, [one, many]]) => `${counts[k].toLocaleString()} ${counts[k] === 1 ? one : many}`)
			.join(', ') || 'nothing';
	// Picking another file hides the preview of the last one until it is checked too.
	let stale = $state(false);
	const preview = $derived(form && 'preview' in form && !stale ? form.preview : null);
	const imported = $derived(form && 'imported' in form ? form.imported : null);
	let checking = $state(false);
</script>

<svelte:head><title>Data · Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Data</h1>
	<a href="/settings">‹ Settings</a>
</header>

<section class="card stack">
	<h2 style="margin: 0">Download your data</h2>
	<p class="muted small-text" style="margin: 0">
		<strong>Everything (JSON)</strong> is a full backup: habits, Tasks, every log, slip, note and setting. It can be imported
		here or on another ittracks server. <strong>Tables (CSV)</strong> is a zip of tidy tables (one row per logged value, per
		habit day, per habit and per field) with a README that explains every column, for Excel, Google Sheets, Python, R or an AI chat.
	</p>
	<div class="row">
		<a class="button" href="/api/v1/export?format=json" download>Everything (JSON)</a>
		<a class="button" href="/api/v1/export?format=csv" download>Tables (CSV)</a>
	</div>
</section>

<section class="card stack">
	<h2 style="margin: 0">Restore from an export</h2>
	<p class="muted small-text" style="margin: 0">
		Replaces every habit, Task, log, note and setting in this account with the ones in the file. Your login, keys and
		reminder devices stay. Download an export first if you might want today's data back.
	</p>
	<form
		method="POST"
		action="?/preview"
		enctype="multipart/form-data"
		class="stack"
		use:enhance={() => {
			checking = true;
			stale = false;
			return async ({ update }) => {
				checking = false;
				await update({ reset: false });
			};
		}}
	>
		<input type="file" name="file" accept=".json,application/json" required onchange={() => (stale = true)} />
		{#if preview}
			<div class="preview stack">
				<p style="margin: 0">
					Exported{preview.username ? ` by ${preview.username}` : ''}{preview.exportedAt ? ` on ${new Date(preview.exportedAt).toLocaleString()}` : ''}:
					{summary(preview.counts)}.
				</p>
				{#if !preview.includesNotes}<p class="muted small-text" style="margin: 0">This export has no notes or journal in it.</p>{/if}
				<label class="check"><input type="checkbox" name="confirm" value="yes" /> Replace all my data with this file</label>
				<button class="danger" formaction="?/import">Replace my data</button>
			</div>
		{:else}
			<button disabled={checking}>{checking ? 'Checking…' : 'Check file'}</button>
		{/if}
	</form>
	{#if form && 'importError' in form}<p class="error" style="margin: 0">{form.importError}</p>{/if}
	{#if imported}
		<p style="margin: 0">
			Restored {summary(imported)}.{form && 'renumbered' in form && form.renumbered
				? ' Another account on this server had the same ids, so they were renumbered: old quick-log links need updating.'
				: ''}
		</p>
	{/if}
</section>

<section class="card stack">
	<h2 style="margin: 0">Export a habit</h2>
	<p class="muted small-text" style="margin: 0">
		Saves a habit and its Tasks as a template file you can share or import elsewhere, with its Areas and the Tasks its
		auto-filled slots pick from. Share… adds a description and questions for the person adding it. Your logs stay here.
	</p>
	{#if data.habits.length}
		<ul class="list">
			{#each data.habits as h (h.id)}
				<li class="row" style="align-items: center">
					<span class="grow">{h.name}</span>
					<a class="button export" href="/habits/{h.id}/template.json" download>Export</a>
					<a class="button export" href="/habits/{h.id}/share">Share…</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted" style="margin: 0">No habits yet.</p>
	{/if}
</section>

<section class="card stack">
	<h2 style="margin: 0">Import or browse</h2>
	<p class="muted small-text" style="margin: 0">
		<a href="/habits/import">Import a template file</a> (you see what it adds and answer its questions first), or pick a
		ready-made one from the <a href="/gallery">gallery</a>.
	</p>
</section>

<section class="card stack">
	<h2 style="margin: 0">Shortcuts</h2>
	<p class="muted small-text" style="margin: 0">
		Every habit has a quick-log link: <code>/q/&lt;habit&gt;</code> opens today's quick log, <code>/q/&lt;habit&gt;?go=1</code>
		logs "Same as last time" at once, and <code>?value=250</code> adds a number. Use them from a bookmark, iOS Shortcuts or an
		Android launcher; with a key they work without signing in (see <a href="/settings/integrations">Integrations</a>). Habits
		marked "Add to home screen shortcuts" show up when you long-press the installed app's icon (reinstall the app to refresh them).
	</p>
</section>

<style>
	.small-text {
		font-size: 0.85rem;
	}
	.preview {
		padding: 0.6rem;
		border: 1px solid var(--danger);
		border-radius: 8px;
	}
	label.check {
		display: flex;
		align-items: baseline;
		color: var(--text);
	}
	.export {
		padding: 0.25rem 0.6rem;
		font-size: 0.85rem;
	}
</style>
