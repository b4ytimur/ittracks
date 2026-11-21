<script lang="ts">
	import TemplatePreview from '$lib/TemplatePreview.svelte';
	import { templateFile, type TemplateFile } from '$lib/template';

	let { data, form } = $props();

	let text = $state('');
	let tpl = $state.raw<TemplateFile | null>(null);
	let problem = $state('');

	async function read(e: Event & { currentTarget: HTMLInputElement }) {
		problem = '';
		tpl = null;
		const file = e.currentTarget.files?.[0];
		if (!file) return;
		if (file.size > 1_000_000) return (problem = 'That file is too large for a template.');
		const raw = await file.text();
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			return (problem = 'That file is not valid JSON.');
		}
		const parsed = templateFile.safeParse(json);
		if (!parsed.success) return (problem = 'That file is not an ittracks template.');
		text = raw;
		tpl = parsed.data;
	}
</script>

<svelte:head><title>Import a template · ittracks</title></svelte:head>

<header class="bar">
	<h1>{tpl ? tpl.name : 'Import a template'}</h1>
	<a href="/habits">Habits</a>
</header>

<label
	>Template file
	<input type="file" accept=".json,application/json" onchange={read} aria-label="Template file" /></label
>
<p class="muted small-text">A <code>.ittracks.json</code> file someone shared, or one you exported. Nothing is added until you press Add.</p>
{#if problem}<p class="error">{problem}</p>{/if}

{#if tpl}
	{#key text}
		<form method="POST" action="?/add" class="stack" style="margin-top: 1rem">
			<input type="hidden" name="template" value={text} />
			<TemplatePreview {tpl} today={data.today} libraryNames={data.libraryNames} habitNames={data.habitNames} areaNames={data.areaNames} />
			{#if form?.error}<p class="error">{form.error}</p>{/if}
			<button class="primary">Add this habit</button>
			<p class="muted small-text">You can change the schedule, Tasks and targets afterwards in the habit editor.</p>
		</form>
	{/key}
{:else if form?.error}
	<p class="error">{form.error}</p>
{/if}

<style>
	.small-text {
		font-size: 0.85rem;
	}
</style>
