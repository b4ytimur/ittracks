<script lang="ts">
	// The heading of a group of rows: fold it, see its swatch and its count. Its slot holds the grip when one
	// is passed (a list of headings that can be moved), and opens empty with `slotOpen`, so the title keeps the
	// column of rows under it that have a grip or a checkbox. `more` puts the heading's own acts in a ⋯ at its end;
	// with `onrename` the title turns into a box where it stands while `renaming` is set (Rename in that ⋯).
	import { tick, type Snippet } from 'svelte';
	import InlineText from './InlineText.svelte';
	import MenuButton, { type Way } from './MenuButton.svelte';

	let {
		title,
		color,
		icon,
		count,
		folded = false,
		onfold,
		grip,
		slotOpen = false,
		foldColumn = false,
		onrename,
		renaming = $bindable(false),
		verb,
		more
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
		/** No fold, over rows: the fold's column stays empty, so the title is on the rows' name column as a folding one's is. */
		foldColumn?: boolean;
		onrename?: (name: string) => void;
		/** With onrename: the title is a box now. It goes false when the box closes. */
		renaming?: boolean;
		verb?: Snippet;
		/** The heading's own acts (an Area's Rename, Colour and icon, Delete), in a ⋯ at its end. */
		more?: (Way | '-')[];
	} = $props();
	const id = $props.id();
	const slotted = $derived(slotOpen || !!grip);
	/** The box closed: Enter or Esc leave the focus nowhere, so it goes back to the ⋯ it came from. */
	async function closed() {
		renaming = false;
		await tick();
		if (document.activeElement === document.body) el?.querySelector<HTMLElement>(':scope > .more > button')?.focus();
	}

	// Pinned to the top while its group scrolls under it: over the rows then, and with a line.
	let el = $state<HTMLElement>();
	let stuck = $state(false);
	$effect(() => {
		const h = el;
		if (!h) return;
		void slotted; // The slot opens with a grip or the page's Select, which pins the title line and the headings under it.
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

<!-- With a grip inside, the heading is named by its title alone, never "Move X X" (a heading reads as its title). -->
<h2 class="group-heading section-title" aria-labelledby={grip ? `${id}-t` : undefined} class:stuck class:slotted class:fold-column={foldColumn && !onfold} bind:this={el}>
	{#if onfold}
		<button type="button" class="fold" aria-expanded={!folded} aria-labelledby="{id}-t" onclick={onfold}><span class="chev" aria-hidden="true">›</span></button>
	{/if}
	<span class="slot">{@render grip?.()}</span>
	{#if color}<span class="swatch" style:--c={color}></span>{/if}
	{#if icon}<span class="icon" aria-hidden="true">{icon}</span>{/if}
	<span class="title" id="{id}-t"
		>{#if onrename}<InlineText value={title} bind:open={() => renaming, (v) => (v ? (renaming = true) : void closed())} label="Name of {title}" onsave={onrename} />{:else}{title}{/if}</span
	>
	{#if count}<span class="tags"><span class="tag count">{count}</span></span>{/if}
	{#if verb}{@render verb()}{/if}
	{#if more?.length}<span class="more"><MenuButton class="quiet glyph" label="More on {title}" items={more} /></span>{/if}
</h2>
