<script lang="ts">
	// The heading of a group of rows: fold it, see its swatch and its count. While editing it can
	// be moved, renamed and recoloured where it stands.
	import type { Snippet } from 'svelte';
	import InlineText from './InlineText.svelte';
	import type { Mode } from './list';

	let {
		title,
		depth = 1,
		mode = 'use',
		color,
		icon,
		count,
		folded = false,
		onfold,
		grip,
		onrename,
		hidden = false,
		struck = false,
		verb,
		after
	}: {
		title: string;
		depth?: 1 | 2;
		mode?: Mode;
		color?: string | null;
		icon?: string | null;
		count?: string;
		folded?: boolean;
		onfold?: () => void;
		grip?: Snippet;
		onrename?: (name: string) => void;
		hidden?: boolean;
		struck?: boolean;
		verb?: Snippet;
		/** Right after the swatch while editing, such as the button that opens the colours. */
		after?: Snippet;
	} = $props();
	const id = $props.id();

	// Pinned to the top while its group scrolls under it: over the rows then, and with a line.
	let el = $state<HTMLElement>();
	let stuck = $state(false);
	$effect(() => {
		const h = el;
		if (!h) return;
		void mode; // Editing pins the title line, and the headings under it.
		let o: IntersectionObserver | undefined;
		const frame = requestAnimationFrame(() => {
			const top = parseFloat(getComputedStyle(h).top) || 0;
			o = new IntersectionObserver(([e]) => (stuck = e.intersectionRatio < 1 && e.boundingClientRect.top <= top), { threshold: [0, 1], rootMargin: `-${top + 1}px 0px 0px 0px` });
			o.observe(h);
		});
		return () => {
			cancelAnimationFrame(frame);
			o?.disconnect();
		};
	});
</script>

<svelte:element
	this={depth === 1 ? 'h2' : 'h3'}
	class="group-heading {depth === 1 ? 'section-title' : 'card-title'}"
	class:hidden-item={hidden}
	class:struck
	class:stuck
	bind:this={el}
	data-depth={depth}
	data-mode={mode}
>
	{#if onfold}
		<button type="button" class="fold" aria-expanded={!folded} aria-labelledby="{id}-t" onclick={onfold}><span class="chev" aria-hidden="true">›</span></button>
	{/if}
	<span class="slot">{#if mode === 'edit'}{@render grip?.()}{/if}</span>
	{#if mode === 'edit' && after}{@render after()}{:else if color}<span class="swatch" style:--c={color}></span>{/if}
	{#if icon}<span class="icon" aria-hidden="true">{icon}</span>{/if}
	<span class="title" id="{id}-t">{#if onrename}<InlineText value={title} editing={mode === 'edit'} label="Name of {title}" onsave={onrename} />{:else}{title}{/if}</span>
	{#if count}<span class="tags"><span class="tag count">{count}</span></span>{/if}
	{#if verb}{@render verb()}{/if}
</svelte:element>
