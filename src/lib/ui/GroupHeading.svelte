<script lang="ts">
	// The heading of a group of rows: fold it, see its swatch and its count. Its slot holds the grip when one
	// is passed (a list of headings that can be moved), and opens empty with `slotOpen`, so the title keeps the
	// column of rows under it that have a grip or a checkbox. With `onrename` the title is changed where it stands.
	import type { Snippet } from 'svelte';
	import InlineText from './InlineText.svelte';

	let {
		title,
		color,
		icon,
		count,
		folded = false,
		onfold,
		grip,
		slotOpen = false,
		onrename,
		verb,
		after
	}: {
		title: string;
		color?: string | null;
		icon?: string | null;
		count?: string;
		folded?: boolean;
		onfold?: () => void;
		grip?: Snippet;
		/** The slot opens with no grip in it: the rows under it have grips or checkboxes. */
		slotOpen?: boolean;
		onrename?: (name: string) => void;
		verb?: Snippet;
		/** Takes the swatch's place, such as the button that opens the colours. */
		after?: Snippet;
	} = $props();
	const id = $props.id();
	const slotted = $derived(slotOpen || !!grip);

	// Pinned to the top while its group scrolls under it: over the rows then, and with a line.
	let el = $state<HTMLElement>();
	let stuck = $state(false);
	$effect(() => {
		const h = el;
		if (!h) return;
		void slotted; // The slot opens with the page's Edit or Select, which pins the title line and the headings under it.
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

<h2 class="group-heading section-title" class:stuck class:slotted bind:this={el}>
	{#if onfold}
		<button type="button" class="fold" aria-expanded={!folded} aria-labelledby="{id}-t" onclick={onfold}><span class="chev" aria-hidden="true">›</span></button>
	{/if}
	<span class="slot">{@render grip?.()}</span>
	{#if after}{@render after()}{:else if color}<span class="swatch" style:--c={color}></span>{/if}
	{#if icon}<span class="icon" aria-hidden="true">{icon}</span>{/if}
	<span class="title" id="{id}-t">{#if onrename}<InlineText value={title} editing label="Name of {title}" onsave={onrename} />{:else}{title}{/if}</span>
	{#if count}<span class="tags"><span class="tag count">{count}</span></span>{/if}
	{#if verb}{@render verb()}{/if}
</h2>
