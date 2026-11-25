<script lang="ts" module>
	export type { Way } from './MenuButton.svelte';
</script>

<script lang="ts">
	// Log a habit: the usual way on the button, the others behind ⋯.
	import { enhance } from '$app/forms';
	import MenuButton, { type Way } from './MenuButton.svelte';

	let { name, act, ways = [], primary = false }: { name: string; act: Way; ways?: (Way | '-')[]; primary?: boolean } = $props();
	const uid = $props.id();
</script>

{#if act.action}
	<form id={uid} method="POST" action={act.action} use:enhance={act.submit ?? (() => {})} hidden>
		{#each Object.entries(act.fields ?? {}) as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}
	</form>
{/if}
<div class="log-control">
	{#if act.href}
		<a class="button log-act" class:primary href={act.href} aria-label="{act.label}: {name}">{act.label}</a>
	{:else if act.action}
		<button class="log-act" class:primary form={uid} aria-label="{act.label}: {name}">{act.label}</button>
	{:else}
		<button type="button" class="log-act" class:primary onclick={act.onselect} aria-label="{act.label}: {name}">{act.label}</button>
	{/if}
	{#if ways.length}<MenuButton class="log-more {primary ? 'primary' : ''}" label="More ways to log {name}" menuLabel="Log {name}" items={ways} />{/if}
</div>
