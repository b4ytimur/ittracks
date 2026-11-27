<script lang="ts" module>
	/** Where Esc is the field's own (closing a picker, clearing words, an open popover or dialog), never the page's; and
	 * anywhere while a row is held (EditableList puts .el-dragging on <html>), where Esc only puts the row back. */
	const OWN_ESC = 'input:not([type=radio], [type=checkbox]), textarea, select, [popover], dialog, .el-dragging';
	type Key = { key: string; defaultPrevented: boolean; target: EventTarget | null };

	/** Whether the state is on after a press of its button or a key: a second press leaves, and so does Esc outside a field. */
	export const next = (pressed: boolean, input: 'press' | Key): boolean =>
		input === 'press' ? !pressed : pressed && !(input.key === 'Escape' && !input.defaultPrevented && !(input.target as Element | null)?.closest?.(OWN_ESC));
</script>

<script lang="ts">
	// The top of a page: its back link, its title, its one add and its ⋯, with the line under it. A page with a second
	// state (Select, Change the plan) shows it as one pressed button here. While it is on, the line pins, the other actions
	// step back in place (so nothing moves), and the line under the title says what a tap does now. Esc or a second
	// press leaves. Its look is title-line.css. A state that changes one line of the page (the Log's Change the plan) has
	// its way in at the end of the hint line instead, and while it is on the title line holds one primary, Done, in the
	// actions' place.
	import { tick, type Snippet } from 'svelte';
	import MenuButton, { type Way } from './MenuButton.svelte';

	let {
		title,
		back,
		add,
		addHidden = false,
		more = [],
		actions,
		hint,
		state: second // `state` would shadow the $state rune here
	}: {
		title: string;
		back?: { href: string; label: string };
		/** The one thing the page makes, first after the title (New habit). */
		add?: { label: string; href?: string; onclick?: () => void };
		/** The add steps back in place while another one is open (Stats' card builder), so the line never moves. */
		addHidden?: boolean;
		/** Everything else the page offers, in the ⋯ after the add. */
		more?: (Way | '-')[];
		/** Today's own frame and a day's Back to today; every other page uses add and more. */
		actions?: Snippet;
		/** The line under the title: words, or more than words (a day's date and count). */
		hint?: string | Snippet;
		/** The page's one second state, as a pressed button outside the actions; hint is what the line says while it is on. */
		state?: {
			label: string;
			pressed: boolean;
			onchange: (pressed: boolean) => void;
			hint: string;
			/** 'hint': a quiet button with the label ends the hint line, no pressed button; while on, Done is the line's one primary. */
			way?: 'hint';
		};
	} = $props();

	const on = $derived(!!second?.pressed);
	const fromHint = $derived(second?.way === 'hint');
	// Done is described by the state's hint, so a screen reader hears what changes, as a pressed toggle says it is pressed.
	const uid = $props.id();
	let done = $state<HTMLButtonElement>();
	let wayIn = $state<HTMLButtonElement>();
	let bar = $state<HTMLElement>();
	let stuck = $state(false);
	const go = (input: 'press' | Key) => {
		if (!second || next(second.pressed, input) === second.pressed) return;
		second.onchange(!second.pressed);
		// The way in and Done take each other's place, so focus goes with them instead of falling to the page.
		if (fromHint) void tick().then(() => (on ? done : wayIn)?.focus());
	};
	$effect(() => {
		if (!on) return;
		document.documentElement.classList.add('pinned');
		return () => document.documentElement.classList.remove('pinned');
	});
</script>

<svelte:window onscroll={() => (stuck = on && !!bar && bar.getBoundingClientRect().top <= 0 && window.scrollY > 0)} onkeydown={go} />

<header class="titlebar" class:stuck={stuck && on} data-mode={on ? 'state' : 'use'} data-add-hidden={addHidden ? '' : null} bind:this={bar}>
	{#if back}<a class="title-back" href={back.href} aria-label="Back to {back.label}"><span aria-hidden="true">‹</span> {back.label}</a>{/if}
	<h1 class="page-title">{title}</h1>
	{#if fromHint && on}
		<div class="title-actions" data-done><button type="button" class="primary" aria-describedby="{uid}-state" bind:this={done} onclick={() => go('press')}>Done</button></div>
	{:else if actions || add || more.length}
		<div class="title-actions" inert={on}>
			{@render actions?.()}
			{#if add?.href}<a class="button primary" data-add href={add.href}>{add.label}</a>
			{:else if add}<button type="button" class="primary" data-add onclick={add.onclick}>{add.label}</button>{/if}
			{#if more.length}<MenuButton class="button" label="More on {title}" items={more} />{/if}
		</div>
	{/if}
	{#if second && !fromHint}<button type="button" class="toggle" aria-pressed={on} onclick={() => go('press')}><span data-reserve={second.label}>{second.label}</span></button>{/if}
</header>
{#if hint !== undefined || second}
	<p class="hint-line meta" data-mode={on ? 'state' : 'use'}>
		<span data-hint="use" inert={on}>{#if typeof hint === 'function'}{@render hint()}{:else}{hint ?? ''}{/if}{#if second && fromHint}<span class="hint-tools"><button type="button" class="quiet" bind:this={wayIn} onclick={() => go('press')}>{second.label}</button></span>{/if}</span>
		{#if second}<span data-hint="state" id={fromHint ? `${uid}-state` : undefined} inert={!on}>{second.hint}</span>{/if}
	</p>
{/if}
