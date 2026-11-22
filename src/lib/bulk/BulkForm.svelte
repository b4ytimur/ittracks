<script lang="ts">
	// Asks for a bulk action's input from its field specs (fields.ts). One form for every action.
	import type { FieldSpec, FieldSources } from './fields';

	let {
		fields,
		values = $bindable(),
		sources = {}
	}: {
		fields: FieldSpec[];
		values: Record<string, unknown>;
		sources?: FieldSources;
	} = $props();

	const uid = `bf-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="fields">
	{#each fields as f (f.key)}
		{@const id = `${uid}-${f.key}`}
		{#if f.kind === 'date'}
			<label for={id}>{f.label}</label>
			<input {id} type="date" bind:value={values[f.key]} required />
		{:else if f.kind === 'select'}
			<label for={id}>{f.label}</label>
			<select {id} bind:value={values[f.key]}>
				{#if f.empty !== undefined}<option value={null}>{f.empty}</option>{/if}
				{#each sources[f.source] ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
			</select>
		{:else if f.kind === 'text'}
			<label for={id}>{f.label}{f.optional ? ' (optional)' : ''}</label>
			<input {id} type="text" bind:value={values[f.key]} placeholder={f.placeholder} list={f.suggest ? `${id}-list` : undefined} maxlength="120" />
			{#if f.suggest}
				<datalist id="{id}-list">{#each sources[f.suggest] ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}</datalist>
			{/if}
		{:else if f.kind === 'toggle'}
			<span class="label">{f.label}</span>
			<div class="row" role="radiogroup" aria-label={f.label}>
				<label class="check"><input type="radio" name={id} checked={values[f.key] === true} onchange={() => (values[f.key] = true)} /> {f.on}</label>
				<label class="check"><input type="radio" name={id} checked={values[f.key] === false} onchange={() => (values[f.key] = false)} /> {f.off}</label>
			</div>
		{:else if f.kind === 'choice'}
			<span class="label">{f.label}</span>
			<div class="stack" role="radiogroup" aria-label={f.label}>
				{#each f.options as o (o.value)}
					<label class="check"><input type="radio" name={id} value={o.value} bind:group={values[f.key]} /> {o.label}</label>
				{/each}
			</div>
		{/if}
		{#if f.hint}<p class="muted hint">{f.hint}</p>{/if}
	{/each}
</div>

<style>
	.fields {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.5rem 0.75rem;
		align-items: center;
	}
	.label {
		color: var(--text);
	}
	.check {
		color: var(--text);
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}
	.hint {
		grid-column: 1 / -1;
		margin: 0;
		font-size: 0.85rem;
	}
	@media (max-width: 480px) {
		.fields {
			grid-template-columns: 1fr;
		}
	}
</style>
