<script lang="ts">
	import TemplateSentence from '$lib/say/TemplateSentence.svelte';
	import { addFrom } from '$lib/say/add';
	import TitleLine from '$lib/ui/TitleLine.svelte';

	let { data } = $props();
	const inside = $derived(data.template.children.length);
	let problem = $state('');
	let busy = $state(false);
	async function add(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		problem = await addFrom('?/add', new FormData(e.target as HTMLFormElement));
		busy = false;
	}
</script>

<svelte:head><title>{data.template.name} · Gallery · ittracks</title></svelte:head>

<TitleLine title={data.template.name} back={{ href: '/gallery', label: 'Gallery' }} hint={data.template.description.split('\n')[0]} />

{#if data.saved}<p class="notice" role="status"><span class="notice-text">Saved to your Gallery. Add it from here whenever you like, or download it to send to someone.</span></p>{/if}

<form onsubmit={add}>
	<TemplateSentence tpl={data.template} today={data.today} libraryNames={data.libraryNames} habitNames={data.habitNames} areaNames={data.areaNames} brings={data.brings} />
	{#if problem}<p class="error" role="alert">{problem}</p>{/if}
	<div class="ob-add l-cluster"><button class="primary" aria-disabled={busy}>{busy ? 'Adding…' : inside ? `Add these ${inside + 1} habits` : 'Add this habit'}</button><span class="meta muted">Anything can be changed on its page afterwards.</span></div>
</form>

{#if data.mine}
	<div class="l-cluster mine">
		<a class="button" href="/gallery/{data.slug}/template.json" download>Download the file</a>
		<form method="POST" action="?/delete"><button class="quiet">Remove from my Gallery</button></form>
		<span class="meta muted">Removing it keeps the habits you added from it.</span>
	</div>
{/if}

<style>
	.mine {
		margin-block-start: var(--space-section);
	}
</style>
