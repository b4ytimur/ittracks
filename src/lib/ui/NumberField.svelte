<script lang="ts">
	// A number with − and + beside it, for one thumb: hold to repeat, arrow keys in the box step too.
	let {
		value,
		step = 1,
		label,
		unit = '',
		large = false,
		placeholder = '',
		caption,
		disabled = false,
		onchange,
		onenter
	}: {
		value: number | null | undefined;
		step?: number;
		/** The whole name, for screen readers: "Weight for Bench press, set 2". */
		label: string;
		unit?: string;
		large?: boolean;
		placeholder?: string;
		caption?: string;
		disabled?: boolean;
		onchange: (v: number | null) => void;
		onenter?: (e: KeyboardEvent) => void;
	} = $props();

	const id = $props.id();
	const round = (n: number) => Math.round(n * 1000) / 1000;
	const bump = (by: number) => onchange(Math.max(0, round((value ?? 0) + by)));
	/** What is being typed, while it isn't a number yet ("7,"). */
	let typed = $state<string | null>(null);
	const shown = $derived(typed ?? (value === null || value === undefined ? '' : String(value)));
	const read = (t: string) => Number(t.trim().replace(',', '.'));
	const bad = $derived(typed !== null && typed.trim() !== '' && !(read(typed) >= 0));

	function input(t: string) {
		typed = t;
		if (t.trim() === '') onchange(null);
		else if (read(t) >= 0) onchange(read(t));
	}

	let hold: ReturnType<typeof setTimeout> | undefined;
	let held = false;
	function press(by: number) {
		held = false;
		clearTimeout(hold);
		const again = () => {
			held = true;
			bump(by);
			hold = setTimeout(again, 90);
		};
		hold = setTimeout(again, 450);
	}
	const lift = () => clearTimeout(hold);
	$effect(() => lift);
	function keydown(e: KeyboardEvent) {
		const by = { ArrowUp: step, ArrowDown: -step, PageUp: step * 5, PageDown: -step * 5 }[e.key];
		if (by) {
			e.preventDefault();
			typed = null;
			bump(by);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			onenter?.(e);
		}
	}
</script>

{#snippet button(by: number, sign: string, word: string)}
	<button
		type="button"
		tabindex="-1"
		class:lg-step={large}
		{disabled}
		aria-label="{step}{unit ? ` ${unit}` : ''} {word}, {label}"
		onpointerdown={() => press(by)}
		onpointerup={lift}
		onpointerleave={lift}
		onpointercancel={lift}
		oncontextmenu={(e) => held && e.preventDefault()}
		onclick={() => {
			typed = null;
			if (!held) bump(by);
			held = false;
		}}>{sign}</button
	>
{/snippet}

<div class="stepper" class:lg-num={large}>
	{@render button(-step, '−', 'less')}
	<input
		type="text"
		inputmode="decimal"
		enterkeyhint="next"
		autocomplete="off"
		class="num"
		class:lg-value={large}
		class:lg-long={large && shown.length > 4}
		value={shown}
		{placeholder}
		{disabled}
		aria-label="{label}{unit ? `, ${unit}` : ''}"
		aria-invalid={bad}
		aria-describedby={bad || caption !== undefined ? `${id}-c` : undefined}
		onfocus={(e) => e.currentTarget.select()}
		oninput={(e) => input(e.currentTarget.value)}
		onblur={() => (typed = null)}
		onkeydown={keydown}
	/>
	{@render button(step, '+', 'more')}
</div>
{#if bad || caption !== undefined}<p class="value-caption meta" id="{id}-c">{bad ? 'Type a number, such as 62.5.' : caption}</p>{/if}

<style>
	p {
		margin: 0;
	}
</style>
