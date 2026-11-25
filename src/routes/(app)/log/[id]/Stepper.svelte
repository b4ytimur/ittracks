<script lang="ts">
	// A number field with big minus and plus buttons, for logging with one thumb.
	let {
		value,
		step = 1,
		label,
		placeholder = '',
		changed = false,
		compact = false,
		onchange
	}: {
		value: number | null | undefined;
		step?: number;
		label: string;
		placeholder?: string;
		changed?: boolean;
		compact?: boolean;
		onchange: (v: number | null) => void;
	} = $props();

	const round = (n: number) => Math.round(n * 1000) / 1000;
	const bump = (by: number) => onchange(Math.max(0, round((value ?? 0) + by)));
	const shown = $derived(value === null || value === undefined ? '' : String(value));
</script>

<div class="stepper" class:compact>
	<button type="button" tabindex="-1" onclick={() => bump(-step)} aria-label="{label} minus {step}">−</button>
	<input
		type="number"
		inputmode="decimal"
		step="any"
		value={shown}
		{placeholder}
		class:changed
		aria-label={label}
		oninput={(e) => onchange(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
	/>
	<button type="button" tabindex="-1" onclick={() => bump(step)} aria-label="{label} plus {step}">+</button>
</div>

<style>
	.stepper {
		display: flex;
		align-items: stretch;
		gap: 0.25rem;
		margin-top: 0.25rem;
	}
	.stepper.compact {
		margin-top: 0;
	}
	.stepper input {
		padding-inline: 2px;
		min-width: 3.1rem;
		text-align: center;
		margin: 0;
	}
	.stepper button {
		min-width: 2.75rem;
		padding: 0.35rem 0;
		font-size: 1.15rem;
		line-height: 1;
	}
	.compact button {
		min-width: 2.25rem;
		font-size: 1rem;
	}
	input.changed {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
</style>
