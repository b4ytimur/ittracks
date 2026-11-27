<script lang="ts" module>
	export type { Way } from './MenuButton.svelte';
</script>

<script lang="ts">
	// Log a habit: the usual way on the button, the others behind ⋯. Once logged, the same control says what it came to
	// ("✓ Target", on a good fill; "↷ Skipped", plain), its ⋯ holds View and Undo, and the hold's Undo stands in for ⋯.
	import { enhance } from '$app/forms';
	import MenuButton, { type Way } from './MenuButton.svelte';

	let {
		name,
		act,
		ways = [],
		primary = false,
		done,
		undo
	}: {
		name: string;
		act?: Way;
		ways?: (Way | '-')[];
		primary?: boolean;
		/** Logged: the word for what it came to ("Done", "Target", "Skipped") in the act's place, and that said in full ("Done at Target"). */
		done?: { word: string; said: string; skipped: boolean };
		/** Just logged, for the hold: one tap undoes it, in the ⋯'s place. */
		undo?: () => void;
	} = $props();
	const uid = $props.id();
</script>

{#if done}
	<div class="log-control">
		<span class="button log-act log-done" class:skipped={done.skipped}><span class="mark" aria-hidden="true">{done.skipped ? '↷' : '✓'}</span> {done.word}</span>
		{#if undo}
			<button type="button" class="log-more log-done log-undo" class:skipped={done.skipped} aria-label="Undo {name}" onclick={undo}>Undo</button>
		{:else if ways.length}
			<MenuButton class="log-more log-done {done.skipped ? 'skipped' : ''}" label="{done.said}: {name}. More" menuLabel={name} items={ways} />
		{/if}
	</div>
{:else if act}
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
{/if}
