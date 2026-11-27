<script lang="ts" module>
	import type { SubmitFunction } from '@sveltejs/kit';

	/** One thing to choose: a form action with its fields, a page to open, or something this page does. */
	export interface Way {
		label: string;
		/** What it comes to, under its name ("45 min"). */
		value?: string;
		action?: string;
		fields?: Record<string, string>;
		submit?: SubmitFunction;
		href?: string;
		onselect?: () => void;
		/** One of a set, and whether it is the one now. */
		checked?: boolean;
		/** The ghost slot at the end of a list, as a menu row: dashed, with + in the ✓ column (TS.10). */
		ghost?: boolean;
		download?: boolean;
	}

	// Placement (R2.6) and keys, shared with EditableList's Move menu, which hangs from the grip's row.
	/** Below `from` where a menu `tall` px tall fits, else on the side with more room, and how tall it may grow (it scrolls inside). */
	export function menuFit(from: DOMRect, tall: number): { up: boolean; room: number } {
		// The floor is the tab bar, or the band above it while it shows: a menu never runs under either.
		const band = document.querySelector('.band')?.getBoundingClientRect();
		const bar = Math.min(document.querySelector('.tabbar')?.getBoundingClientRect().top ?? window.innerHeight, band && band.height > 0 ? band.top : Infinity);
		const below = bar - from.bottom - 12;
		const above = from.top - 12;
		const up = tall > below && above > below;
		return { up, room: Math.max(120, up ? above : below) };
	}
	/** How far an open menu moves so it stands 8px clear of the screen's edge on the side it grows toward. */
	export function menuNudge(box: DOMRect, align: 'start' | 'end'): number {
		if (align === 'end') return box.left < 8 ? 8 - box.left : 0;
		// The page's width, not innerWidth: on a phone the menu's own overflow widens innerWidth to fit it.
		const edge = document.documentElement.clientWidth - 8;
		return box.right > edge ? box.right - edge : 0;
	}
	/** An open menu's keys: arrows, Home and End move through its items, Esc closes it back to its button, Tab closes it. */
	export function menuKeys(e: KeyboardEvent, items: HTMLElement[], close: (refocus?: boolean) => void) {
		const at = items.indexOf(document.activeElement as HTMLElement);
		const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key];
		if (to !== undefined) {
			e.preventDefault();
			items[(to + items.length) % items.length]?.focus();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		} else if (e.key === 'Tab') close(false);
	}
</script>

<script lang="ts">
	// A button that opens a menu: arrow keys, Home, End, Esc; it opens upward where there is no room below.
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';

	// `trigger` draws the button's face (a word of a sentence); without it the button is ⋯.
	// `align` start hangs the menu from the trigger's start edge (a word in a sentence), end from its end (⋯ at a row's end).
	let { label, menuLabel, items, class: klass = '', trigger, align = 'end' }: { label: string; menuLabel?: string; items: (Way | '-')[]; class?: string; trigger?: import('svelte').Snippet; align?: 'start' | 'end' } = $props();

	const uid = $props.id();
	const formOf = (i: number) => `${uid}-f${i}`;
	let open = $state(false);
	let up = $state(false);
	let room = $state(0);
	let nudge = $state(0);
	let more = $state<HTMLButtonElement>();
	let menu = $state<HTMLElement>();
	const all = () => [...(menu?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])];

	async function show(last = false) {
		open = true;
		await tick();
		({ up, room } = menuFit(more!.getBoundingClientRect(), menu?.scrollHeight ?? 0));
		nudge = 0;
		await tick();
		nudge = menuNudge(menu!.getBoundingClientRect(), align);
		all().at(last ? -1 : 0)?.focus();
	}
	function close(refocus = true) {
		open = false;
		if (refocus) more?.focus();
	}
</script>

<svelte:window
	onpointerdown={(e) => {
		if (open && !menu?.contains(e.target as Node) && !more?.contains(e.target as Node)) close(false);
	}}
/>

{#each items as w, i (i)}
	{#if w !== '-' && w.action}
		<form id={formOf(i)} method="POST" action={w.action} use:enhance={w.submit ?? (() => {})} hidden>
			{#each Object.entries(w.fields ?? {}) as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}
		</form>
	{/if}
{/each}
<button
	type="button"
	class={klass}
	bind:this={more}
	aria-label={label}
	aria-haspopup="menu"
	aria-expanded={open}
	onclick={() => (open ? close() : show())}
	onkeydown={(e) => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			show(e.key === 'ArrowUp');
		}
	}}>{#if trigger}{@render trigger()}{:else}<span aria-hidden="true">⋯</span>{/if}</button
>
<div class="menu" class:start={align === 'start'} role="menu" tabindex="-1" aria-label={menuLabel ?? label} data-side={up ? 'up' : null} style:--menu-room="{room}px" style:--menu-nudge="{nudge}px" hidden={!open} bind:this={menu} onkeydown={(e) => menuKeys(e, all(), close)}>
	{#each items as w, i (i)}
		{#if w === '-'}
			<hr />
		{:else if w.href}
			<a role="menuitem" tabindex="-1" href={w.href} download={w.download ? '' : undefined}><span class="menu-label">{w.label}</span></a>
		{:else}
			<button type={w.action ? 'submit' : 'button'} class:menu-ghost={w.ghost} role={w.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={w.checked} tabindex="-1" form={w.action ? formOf(i) : undefined} onclick={() => (close(), w.onselect?.())}
				>{#if w.checked !== undefined || w.ghost}<span class="menu-check" aria-hidden="true">{w.ghost ? '+' : '✓'}</span>{/if}<span class="menu-label">{w.label}</span>{#if w.value}<span class="menu-note meta">{w.value}</span>{/if}</button
			>
		{/if}
	{/each}
</div>
