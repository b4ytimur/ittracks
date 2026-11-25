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
	}
</script>

<script lang="ts">
	// A button that opens a menu: arrow keys, Home, End, Esc; it opens upward where there is no room below.
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';

	let { label, menuLabel, items, class: klass = '' }: { label: string; menuLabel?: string; items: (Way | '-')[]; class?: string } = $props();

	const uid = $props.id();
	const formOf = (i: number) => `${uid}-f${i}`;
	let open = $state(false);
	let up = $state(false);
	let more = $state<HTMLButtonElement>();
	let menu = $state<HTMLElement>();
	const all = () => [...(menu?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];

	async function show(last = false) {
		open = true;
		await tick();
		const r = more!.getBoundingClientRect();
		const bar = document.querySelector('.tabbar .band')?.getBoundingClientRect().top ?? window.innerHeight;
		up = r.bottom + (menu?.offsetHeight ?? 0) + 8 > bar && r.top > (menu?.offsetHeight ?? 0);
		all().at(last ? -1 : 0)?.focus();
	}
	function close(refocus = true) {
		open = false;
		if (refocus) more?.focus();
	}
	function keys(e: KeyboardEvent) {
		const list = all();
		const at = list.indexOf(document.activeElement as HTMLElement);
		const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[e.key];
		if (to !== undefined) {
			e.preventDefault();
			list[(to + list.length) % list.length]?.focus();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		} else if (e.key === 'Tab') close(false);
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
	}}><span aria-hidden="true">⋯</span></button
>
<div class="menu" role="menu" tabindex="-1" aria-label={menuLabel ?? label} data-side={up ? 'up' : null} hidden={!open} bind:this={menu} onkeydown={keys}>
	{#each items as w, i (i)}
		{#if w === '-'}
			<hr />
		{:else if w.href}
			<a role="menuitem" tabindex="-1" href={w.href}><span class="menu-label">{w.label}</span></a>
		{:else}
			<button type={w.action ? 'submit' : 'button'} role="menuitem" tabindex="-1" form={w.action ? formOf(i) : undefined} onclick={() => (close(), w.onselect?.())}
				><span class="menu-label">{w.label}</span>{#if w.value}<span class="menu-note meta">{w.value}</span>{/if}</button
			>
		{/if}
	{/each}
</div>
