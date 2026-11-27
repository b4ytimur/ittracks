<script lang="ts" generics="T">
	// Groups of rows under headings. Grouped by Area, the Areas are kept where they stand, in Use (MO): each Area's
	// heading has a grip (drag it, or tap it for its Move menu) and a ⋯ with Rename (the name opens as a box in place),
	// Colour and icon, and Delete, each said in the band with Undo, and a New Area slot ends the list while every Area shows
	// (`allAreas`). None of it shows while the page selects: a tap ticks rows then. Grouped by Area every heading's slot is open, so the page opens its
	// rows' slots too (EditableList's slotOpen); otherwise `slotOpen` says whether the rows have grips or checkboxes.
	import { tick, type Snippet } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { showError, showToast } from '$lib/toast.svelte';
	import { AREA_COLORS, COLOR_NAMES } from '$lib/area-colors';
	import EditableList from './EditableList.svelte';
	import GroupHeading from './GroupHeading.svelte';
	import { mergeOrder } from './list';
	import type { Group } from '$lib/views';

	interface Area {
		id: string;
		name: string;
		icon: string;
		color: string;
	}
	let {
		groups,
		areas,
		byArea,
		slotOpen = false,
		selecting = false,
		allAreas = false,
		group
	}: {
		groups: Group<T>[];
		areas: Area[];
		/** The groups are Areas. */
		byArea: boolean;
		/** Not by Area: the rows under the headings have grips or checkboxes, so the headings' slot opens too. */
		slotOpen?: boolean;
		/** The page is selecting: no grips, ⋯ or New Area. */
		selecting?: boolean;
		/** Every Area shows, empty ones too (keepsEmptyAreas): only then does New Area end the list, so a new one shows where it lands. */
		allAreas?: boolean;
		group: Snippet<[Group<T>]>;
	} = $props();

	const areaOf = (key: string) => (byArea ? areas.find((a) => a.id === key) : undefined);
	/** The Area whose name is a box now, and the one whose colours are open. */
	let renaming = $state<string | null>(null);
	let picking = $state<string | null>(null);
	let picker = $state<HTMLElement>();
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
		// A filter can hide some Areas: those keep their places, and the ones shown take theirs in the new order.
		const r = await call({ op: 'move', order: mergeOrder(before, keys.filter((k) => areaOf(k))) });
		order = null;
		if (r) showToast(said, undo({ op: 'move', order: before }));
	}

	/** The heading's ⋯ that opened the colours. */
	const moreOf = (k: string) => document.querySelector<HTMLElement>(`li[data-key="${CSS.escape(k)}"] > .group-heading > .more > button`);
	/** Colour and icon: the colours open under the heading, on the one it has; again, they close. */
	async function pick(k: string) {
		picking = picking === k ? null : k;
		await tick();
		picker?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
	}
	/** The colours close; focus left nowhere goes back to the ⋯. */
	async function unpick(k: string) {
		picking = null;
		await tick();
		if (document.activeElement === document.body) moreOf(k)?.focus();
	}
	const acts = (a: Area) => [
		{ label: 'Rename', onselect: () => (renaming = a.id) },
		{ label: 'Colour and icon', onselect: () => pick(a.id) },
		{ label: 'Delete', onselect: () => remove(a) }
	];
</script>

<!-- Esc in the colours closes them, with nothing changed. -->
<svelte:window onkeydown={(e) => picking && e.key === 'Escape' && picker?.contains(e.target as Node) && (e.preventDefault(), unpick(picking))} />

{#if !byArea || groups.every((g) => !g.label)}
	{#each groups as g (g.key)}
		{#if g.label}<GroupHeading title={g.label} color={g.color} {slotOpen} count={String(g.items.length)} />{/if}
		{@render group(g)}
	{/each}
{:else}
	<!-- rowCard here only brings the list's New Area slot: layout bare draws each Area itself. -->
	<EditableList
		items={list}
		key={(g) => g.key}
		label={(g) => areaOf(g.key)?.name ?? g.label}
		layout="bare"
		rowCard
		ariaLabel="Areas"
		canDrop={(m) => m.position !== 'inside' && !!areaOf(m.key) && (!!areaOf(m.target) || m.position === 'before')}
		onmove={selecting ? undefined : (_, keys, text) => (void move(keys, text), true)}
		onadd={selecting || !allAreas ? undefined : add}
		addLabel="New Area"
	>
		{#snippet row(g, ctx)}
			{@const a = areaOf(g.key)}
			<GroupHeading
				title={a?.name ?? g.label}
				color={g.color}
				icon={a?.icon}
				slotOpen
				count={String(g.items.length)}
				grip={a ? ctx.grip : undefined}
				onrename={a ? (name) => change(a, { name }) : undefined}
				bind:renaming={() => renaming === g.key, (v) => (renaming = v ? g.key : null)}
				more={a && !selecting ? acts(a) : undefined}
			/>
			{#if a && !selecting && picking === g.key}
				<div class="colors" role="group" aria-label="Colour and icon of {a.name}" bind:this={picker}>
					{#each [...new Set([a.color, ...AREA_COLORS])] as c (c)}
						<button type="button" class="pick-color" aria-pressed={c === a.color} aria-label={COLOR_NAMES[c] ?? c} onclick={() => (unpick(g.key), change(a, { color: c }))}
							><span class="swatch" data-size="picker" style:--c={c}></span></button
						>
					{/each}
					<input class="icon" aria-label="Icon of {a.name}" placeholder="Icon" maxlength="8" value={a.icon} onchange={(e) => (unpick(g.key), change(a, { icon: e.currentTarget.value.trim() }))} />
				</div>
			{/if}
			{@render group(g)}
		{/snippet}
	</EditableList>
{/if}

<style>
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
</style>
