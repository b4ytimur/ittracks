<script lang="ts">
	// The top of every page you can edit: its title, its actions, and the one switch between using,
	// editing and selecting, with a line under it that says what can be done now.
	import type { Snippet } from 'svelte';
	import Segmented from './Segmented.svelte';
	import type { Mode } from './list';

	let {
		title,
		mode = $bindable('use'),
		modes = ['use', 'edit'],
		back,
		hints = {},
		actions,
		tools,
		onreset,
		resetLabel = 'Reset layout',
		atDefault = false,
		onmode
	}: {
		title: string;
		mode?: Mode;
		modes?: Mode[];
		back?: { href: string; label: string };
		/** What the line under the title says in each mode. */
		hints?: Partial<Record<Mode, string>>;
		/** Buttons on the title line, out of reach while editing or selecting. */
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
		if (mode !== 'use' && e.key === 'Escape' && !e.defaultPrevented && !(e.target as HTMLElement)?.closest?.('input:not([type=radio], [type=checkbox]), textarea, select, [popover]')) set('use');
	}}
/>

<header class="titlebar" class:stuck data-mode={mode} bind:this={bar}>
	{#if back}<a class="title-back" href={back.href}>‹ {back.label}</a>{/if}
	<h1 class="page-title">{title}</h1>
	{#if actions}<div class="title-actions" inert={mode !== 'use'}>{@render actions()}</div>{/if}
	{#if modes.length > 1}<Segmented label="Mode" options={modes.map((m) => ({ value: m, label: words[m] }))} value={mode} onchange={set} />{/if}
</header>
{#if Object.keys(hints).length || onreset}
	<p class="hint-line meta" data-mode={mode}>
		{#each modes as m (m)}
			<span data-hint={m} inert={mode !== m}>
				{#if m === 'edit' && onreset}
					<span class="hint-tools">
						<button type="button" class="quiet reset" data-at-default={atDefault ? '' : null} onclick={onreset}>{resetLabel}</button>
					</span>
				{/if}
				{hints[m] ?? ''}
			</span>
		{/each}
	</p>
{/if}
{#if tools && mode === 'edit'}<div class="tools">{@render tools()}</div>{/if}
