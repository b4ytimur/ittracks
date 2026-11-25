<script lang="ts" generics="V extends string">
	// One of a few, side by side. The arrow keys move the choice, as in any radio group.
	let { options, value = $bindable(), label, onchange }: { options: { value: V; label: string }[]; value: V; label: string; onchange?: (v: V) => void } = $props();
	const name = $props.id();
</script>

<div class="segmented" role="radiogroup" aria-label={label}>
	{#each options as o (o.value)}
		<label
			><input
				class="vh"
				type="radio"
				{name}
				value={o.value}
				checked={value === o.value}
				onchange={() => {
					value = o.value;
					onchange?.(o.value);
				}}
			/><span data-reserve={o.label}>{o.label}</span></label
		>
	{/each}
</div>
