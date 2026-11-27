<script lang="ts">
	// The top of every page you can edit: its title, its actions, and the one switch between using,
	// editing and selecting, with a line under it that says what can be done now.
	import type { Snippet } from 'svelte';
	import Segmented from './Segmented.svelte';
	import MenuButton, { type Way } from './MenuButton.svelte';
	import type { Mode } from './list';
	import { next } from './TitleLine.svelte';

	let {
		title,
		mode = $bindable('use'),
		modes = ['use', 'edit'],
		back,
		hints = {},
		add,
		addHidden = false,
		more = [],
		actions,
		tools,
		onreset,
		resetLabel = 'Reset layout',
		atDefault = false,
		useHint,
		onmode
	}: {
		title: string;
		mode?: Mode;
		modes?: Mode[];
		back?: { href: string; label: string };
		/** What the line under the title says in each mode. */
		hints?: Partial<Record<Mode, string>>;
		/** The line under the title in Use, when it holds more than words (Today's date and count, TS.5). */
		useHint?: Snippet;
		/** The one thing the page makes, first after the title (New habit). Out of reach while editing or selecting. */
		add?: { label: string; href?: string; onclick?: () => void };
		/** The add steps back in place while another one is open (Stats' card builder), so the line never moves. */
		addHidden?: boolean;
		/** Everything else the page offers, in the ⋯ after it. Every page's title line reads the same (TS.15). */
		more?: (Way | '-')[];
		/** Today's own frame only (its ⋯, Back to today on another day). Every other page uses add and more. */
		actions?: Snippet;
		/** At the end of the hint line while editing. */
		tools?: Snippet;
		onreset?: () => void;
		resetLabel?: string;
		/** The layout is as it came, so there is nothing to reset. */
		atDefault?: boolean;
		onmode?: (m: Mode) => void;
	} = $props();

	const words: Record<Mode, string> = { use: 'Use', edit: 'Edit', select: 'Select' };
	let bar = $state<HTMLElement>();
	let stuck = $state(false);
	const set = (m: Mode) => {
		mode = m;
		onmode?.(m);
	};
	$effect(() => {
		document.documentElement.classList.toggle('pinned', mode !== 'use');
		return () => document.documentElement.classList.remove('pinned');
	});
</script>

<svelte:window
	onscroll={() => (stuck = mode !== 'use' && !!bar && bar.getBoundingClientRect().top <= 0 && window.scrollY > 0)}
	onkeydown={(e) => {
		// Esc leaves Edit as it leaves TitleLine's state: not in a field, a popover or a dialog (a sheet opened in Edit), which close themselves.
		if (mode !== 'use' && !next(true, e)) set('use');
	}}
/>

<header class="titlebar" class:stuck data-mode={mode} data-add-hidden={addHidden ? '' : null} bind:this={bar}>
	{#if back}<a class="title-back" href={back.href} aria-label="Back to {back.label}"><span aria-hidden="true">‹</span> {back.label}</a>{/if}
	<h1 class="page-title">{title}</h1>
	{#if actions || add || more.length}
		<div class="title-actions" inert={mode !== 'use'}>
			{@render actions?.()}
			{#if add?.href}<a class="button primary" data-add href={add.href}>{add.label}</a>
			{:else if add}<button type="button" class="primary" data-add onclick={add.onclick}>{add.label}</button>{/if}
			{#if more.length}<MenuButton class="button" label="More on {title}" items={more} />{/if}
		</div>
	{/if}
	{#if modes.length > 1}<Segmented label="Mode" options={modes.map((m) => ({ value: m, label: words[m] }))} value={mode} onchange={set} />{/if}
</header>
{#if Object.keys(hints).length || onreset || useHint}
	<p class="hint-line meta" data-mode={mode}>
		{#each modes as m (m)}
			<span data-hint={m} inert={mode !== m}>
				{#if m === 'edit' && onreset}
					<span class="hint-tools">
						<button type="button" class="quiet reset" data-at-default={atDefault ? '' : null} onclick={onreset}>{resetLabel}</button>
					</span>
				{/if}
				{#if m === 'use' && useHint}{@render useHint()}{:else}{hints[m] ?? ''}{/if}
			</span>
		{/each}
	</p>
{/if}
{#if tools && mode === 'edit'}<div class="tools">{@render tools()}</div>{/if}
