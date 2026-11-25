<script lang="ts" generics="T">
	// Groups of rows under headings. Grouped by Area, the Areas are edited where they stand: drag to
	// reorder, rename, recolour, delete (with Undo), and add one at the end.
	import type { Snippet } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { showError, showToast } from '$lib/toast.svelte';
	import { AREA_COLORS, COLOR_NAMES } from '$lib/area-colors';
	import EditableList from './EditableList.svelte';
	import GroupHeading from './GroupHeading.svelte';
	import InlineText from './InlineText.svelte';
	import type { Group } from '$lib/views';
	import type { Mode } from './list';

	interface Area {
		id: string;
		name: string;
		icon: string;
		color: string;
	}
	let {
		groups,
		areas,
		mode,
		byArea,
		group
	}: {
		groups: Group<T>[];
		areas: Area[];
		mode: Mode;
		/** The groups are Areas. */
		byArea: boolean;
		group: Snippet<[Group<T>]>;
	} = $props();

	const areaOf = (key: string) => (byArea ? areas.find((a) => a.id === key) : undefined);
	let picking = $state<string | null>(null);
	let order = $state.raw<string[] | null>(null);
	const list = $derived(order ? [...groups].sort((a, b) => rank(a.key) - rank(b.key)) : groups);
	const rank = (k: string) => {
		const i = order!.indexOf(k);
		return i < 0 ? 999 : i;
	};

	const send = (body: object) => fetch('/api/areas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
	const undo = (body: object) => async () => !!(await send(body))?.ok;
	async function call(body: object): Promise<Record<string, unknown> | null> {
		const r = await send(body);
		if (!r?.ok) {
			showError('Not saved. Are you online?');
			return null;
		}
		const out = await r.json();
		await invalidateAll();
		return out;
	}
	async function change(a: Area, values: { name?: string; color?: string; icon?: string }) {
		const was = 'name' in values ? { name: a.name } : 'icon' in values ? { icon: a.icon } : { color: a.color };
		if (!(await call({ op: 'change', id: a.id, ...values }))) return;
		showToast(values.name ? `Renamed ${a.name} to ${values.name}.` : `${a.name} has a new ${'icon' in values ? 'icon' : 'colour'}.`, undo({ op: 'change', id: a.id, ...was }));
	}
	async function remove(a: Area) {
		const r = await call({ op: 'delete', id: a.id });
		if (r) showToast(`Deleted ${a.name}. What was in it has no Area now.`, undo({ op: 'restore', deleted: r.deleted }));
	}
	async function add(name?: string) {
		if (!name) return;
		const r = await call({ op: 'add', name });
		if (r?.existed) showToast(`There is an Area called ${name} already.`);
		else if (r) showToast(`Added ${name}.`, undo({ op: 'delete', id: r.id }));
	}
	async function move(keys: string[], said: string) {
		const before = areas.map((a) => a.id);
		order = keys;
		const r = await call({ op: 'move', order: keys.filter((k) => areaOf(k)) });
		order = null;
		if (r) showToast(said, undo({ op: 'move', order: before }));
	}
</script>

{#if !byArea || groups.every((g) => !g.label)}
	{#each groups as g (g.key)}
		{#if g.label}<GroupHeading title={g.label} color={g.color} {mode} count={String(g.items.length)} />{/if}
		{@render group(g)}
	{/each}
{:else}
	<EditableList
		items={list}
		key={(g) => g.key}
		label={(g) => areaOf(g.key)?.name ?? g.label}
		mode={mode === 'edit' ? 'edit' : 'use'}
		layout="bare"
		ariaLabel="Areas"
		canDrop={(m) => m.position !== 'inside' && !!areaOf(m.key) && (!!areaOf(m.target) || m.position === 'before')}
		onmove={(_, keys, text) => (void move(keys, text), true)}
	>
		{#snippet row(g, ctx)}
			{@const a = areaOf(g.key)}
			<GroupHeading
				title={a?.name ?? g.label}
				color={g.color}
				icon={a?.icon}
				{mode}
				count={String(g.items.length)}
				grip={a ? ctx.grip : undefined}
				onrename={a ? (name) => change(a, { name }) : undefined}
				after={a ? swatch : undefined}
				verb={a && mode === 'edit' ? del : undefined}
			/>
			{#snippet swatch()}
				<button type="button" class="quiet dot hit" aria-label="Colour of {a?.name}" aria-expanded={picking === g.key} onclick={() => (picking = picking === g.key ? null : g.key)}
					><span class="swatch" style:--c={g.color}></span></button
				>
			{/snippet}
			{#snippet del()}
				<button type="button" class="quiet verb hit" aria-label="Delete {a?.name}" onclick={() => a && remove(a)}>Delete</button>
			{/snippet}
			{#if a && mode === 'edit' && picking === g.key}
				<div class="colors" role="group" aria-label="Colour of {a.name}">
					{#each [...new Set([a.color, ...AREA_COLORS])] as c (c)}
						<button type="button" class="pick-color" aria-pressed={c === a.color} aria-label={COLOR_NAMES[c] ?? c} onclick={() => ((picking = null), change(a, { color: c }))}
							><span class="swatch" data-size="picker" style:--c={c}></span></button
						>
					{/each}
					<input class="icon" aria-label="Icon of {a.name}" placeholder="Icon" maxlength="8" value={a.icon} onchange={(e) => change(a, { icon: e.currentTarget.value.trim() })} />
				</div>
			{/if}
			{@render group(g)}
		{/snippet}
	</EditableList>
	{#if mode === 'edit'}
		<p class="new section-title"><InlineText value="New Area" editing label="Add an Area" onsave={add} /></p>
	{/if}
{/if}

<style>
	.dot {
		padding: 0;
		min-width: var(--target-min);
		margin-inline-end: var(--space-tight);
	}
	.colors {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-inline);
		margin-block-end: var(--space-inline);
	}
	.pick-color {
		display: grid;
		place-items: center;
		width: var(--control-md);
		height: var(--control-md);
		padding: 0;
	}
	.pick-color[aria-pressed='true'] {
		border-color: var(--line-chosen);
		box-shadow: var(--chosen-shadow);
	}
	.icon {
		width: 4.5rem;
	}
	.new {
		margin: var(--space-section) 0 0;
		color: var(--ink-muted);
	}
</style>
