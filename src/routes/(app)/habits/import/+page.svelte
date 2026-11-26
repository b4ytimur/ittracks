<script lang="ts">
	// A template file: checked first, in words. Nothing is added until Add is pressed.
	import TemplateSentence from '$lib/say/TemplateSentence.svelte';
	import { addFrom } from '$lib/say/add';
	import { checkTemplate, type TemplateFile } from '$lib/template';
	import { bringsLine, packById } from '$lib/packs';
	import EditChrome from '$lib/ui/EditChrome.svelte';

	let { data } = $props();

	let text = $state('');
	let tpl = $state.raw<TemplateFile | null>(null);
	let problem = $state('');
	let busy = $state(false);

	async function read(e: Event & { currentTarget: HTMLInputElement }) {
		problem = '';
		tpl = null;
		const file = e.currentTarget.files?.[0];
		if (!file) return;
		const raw = await file.slice(0, 1_000_001).text();
		const c = checkTemplate(raw);
		if (!c.ok) return void (problem = c.why);
		text = raw;
		tpl = c.tpl;
	}
	async function add(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		problem = await addFrom('?/add', new FormData(e.target as HTMLFormElement));
		busy = false;
	}
</script>

<svelte:head><title>Add a template · ittracks</title></svelte:head>

<EditChrome title={tpl ? tpl.name : 'Add a template'} modes={['use']} back={{ href: '/habits', label: 'Habits' }} hints={{ use: tpl?.description.split('\n')[0] || 'A file someone shared, or one you saved. Nothing is added until you press Add.' }} />

<div class="field"><label class="label" for="tpl-file">Template file</label><input id="tpl-file" type="file" accept=".json,application/json" onchange={read} /></div>
{#if problem}<p class="notice" data-tone="error" role="alert"><span class="notice-text">{problem}</span></p>{/if}

{#if tpl}
	{#key text}
		<form onsubmit={add}>
			<input type="hidden" name="template" value={text} />
			<TemplateSentence {tpl} today={data.today} libraryNames={data.libraryNames} habitNames={data.habitNames} areaNames={data.areaNames} brings={bringsLine(tpl.packs.filter((id) => !data.packs.includes(id)).flatMap((id) => packById(id) ?? []))} />
			<div class="ob-add l-cluster"><button class="primary" aria-disabled={busy}>{busy ? 'Adding…' : tpl.children.length ? `Add these ${tpl.children.length + 1} habits` : 'Add this habit'}</button><span class="meta muted">Anything can be changed on its page afterwards.</span></div>
		</form>
	{/key}
{/if}
