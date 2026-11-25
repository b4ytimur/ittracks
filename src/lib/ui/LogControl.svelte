<script lang="ts" module>
	import type { SubmitFunction } from '@sveltejs/kit';

	/** One way to log: a form action with its fields, a page to open, or something this page does. */
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
	// Log a habit: the usual way on the button, the others behind ⋯.
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';

	let { name, act, ways = [], primary = false }: { name: string; act: Way; ways?: (Way | '-')[]; primary?: boolean } = $props();

	const uid = $props.id();
	const forms = $derived([act, ...ways].flatMap((w, i) => (w !== '-' && w.action ? [{ w, id: `${uid}-f${i}` }] : [])));
	const formOf = (w: Way) => forms.find((f) => f.w === w)?.id;

	let open = $state(false);
	let up = $state(false);
	let more = $state<HTMLButtonElement>();
	let menu = $state<HTMLElement>();
	const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];

	async function show(last = false) {
		open = true;
		await tick();
		const r = more!.getBoundingClientRect();
		const bar = document.querySelector('.tabbar .band')?.getBoundingClientRect().top ?? window.innerHeight;
		up = r.bottom + (menu?.offsetHeight ?? 0) + 8 > bar && r.top > (menu?.offsetHeight ?? 0);
		items().at(last ? -1 : 0)?.focus();
	}
	function close(refocus = true) {
		open = false;
		if (refocus) more?.focus();
	}
	function keys(e: KeyboardEvent) {
		const all = items();
		const at = all.indexOf(document.activeElement as HTMLElement);
		const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
		if (to !== undefined) {
			e.preventDefault();
			all[(to + all.length) % all.length]?.focus();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		} else if (e.key === 'Tab') close(false);
	}
</script>

<svelte:window
	onpointerdown={(e) => {
		if (open && !(e.target as HTMLElement).closest(`[data-log="${uid}"]`)) close(false);
	}}
/>

{#each forms as f (f.id)}
	<form id={f.id} method="POST" action={f.w.action} use:enhance={f.w.submit ?? (() => {})} hidden>
		{#each Object.entries(f.w.fields ?? {}) as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}
	</form>
{/each}
<div class="log-control" data-log={uid}>
	{#if act.href}
		<a class="button log-act" class:primary href={act.href} aria-label="{act.label}: {name}">{act.label}</a>
	{:else if act.action}
		<button class="log-act" class:primary form={formOf(act)} aria-label="{act.label}: {name}">{act.label}</button>
	{:else}
		<button type="button" class="log-act" class:primary onclick={act.onselect} aria-label="{act.label}: {name}">{act.label}</button>
	{/if}
	{#if ways.length}
		<button
			type="button"
			class="log-more"
			class:primary
			bind:this={more}
			aria-label="More ways to log {name}"
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
		<div class="menu" role="menu" tabindex="-1" aria-label="Log {name}" data-side={up ? 'up' : null} hidden={!open} bind:this={menu} onkeydown={keys}>
			{#each ways as w, i (i)}
				{#if w === '-'}
					<hr />
				{:else if w.href}
					<a role="menuitem" tabindex="-1" href={w.href}><span class="menu-label">{w.label}</span></a>
				{:else}
					<button type={w.action ? 'submit' : 'button'} role="menuitem" tabindex="-1" form={formOf(w)} onclick={() => (close(), w.onselect?.())}
						><span class="menu-label">{w.label}</span>{#if w.value}<span class="menu-note meta">{w.value}</span>{/if}</button
					>
				{/if}
			{/each}
		</div>
	{/if}
</div>
