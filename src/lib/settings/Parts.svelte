<script lang="ts">
	// The parts of the day, changed where they stand. A row is saved as it is left; one that can't be
	// yet says why and waits.
	import { untrack } from 'svelte';
	import type { DayRange } from '$lib/engine/day';
	import { overlappingRanges } from '$lib/rules/settings';

	let {
		ranges,
		used,
		problem = $bindable(''),
		onsave
	}: {
		ranges: DayRange[];
		/** The part each habit that has one is set for. */
		used: string[];
		problem?: string;
		onsave: (ranges: DayRange[], said: string, renames: Record<string, string>) => void;
	} = $props();

	type Row = DayRange & { was: string };
	const rowsOf = (rs: DayRange[]): Row[] => rs.map((r) => ({ ...r, was: r.name }));
	let rows = $state<Row[]>(untrack(() => rowsOf(ranges)));
	let seen = untrack(() => JSON.stringify(ranges));
	$effect(() => {
		const now = JSON.stringify(ranges);
		if (now === seen) return;
		seen = now;
		untrack(() => {
			// A row being added stays; the rest is as the server has it.
			rows = [...rowsOf(ranges), ...rows.filter((r) => !r.was && !r.name.trim())];
			problem = '';
		});
	});

	const setFor = (n: string) => used.filter((u) => u === n).length;
	function leave(said: string) {
		const next = rows.filter((r) => r.name.trim() || r.was).map((r) => ({ name: r.name.trim(), start: r.start, end: r.end }));
		if (JSON.stringify(next) === JSON.stringify(ranges)) return void (problem = '');
		const twice = next.find((r, i) => next.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) < i);
		const over = overlappingRanges(next);
		problem = next.some((r) => !r.name)
			? 'Not saved yet. Give each part a name, or remove it.'
			: next.some((r) => !r.start || !r.end || r.start === r.end)
				? 'Not saved yet. A part ends at a different time than it starts.'
				: twice
					? `Not saved yet. Two parts are called “${twice.name}”.`
					: over
						? `Not saved yet. ${over[0].name} and ${over[1].name} overlap.`
						: '';
		if (problem) return;
		const renames = Object.fromEntries(rows.filter((r) => r.was && r.name.trim() && r.was !== r.name.trim()).map((r) => [r.was, r.name.trim()]));
		const [from, to] = Object.entries(renames)[0] ?? [];
		onsave(next, from ? `Renamed ${from} to ${to}.` : said, renames);
	}
	function remove(i: number) {
		const [r] = rows.splice(i, 1);
		const n = r.was ? setFor(r.was) : 0;
		leave(`Removed ${r.was || r.name || 'a part'}.${n ? ` ${n} ${n === 1 ? 'habit is' : 'habits are'} set for it, with no time until you pick another.` : ''}`);
	}
	function add() {
		const start = rows.at(-1)?.end || '12:00';
		const end = `${String((Number(start.slice(0, 2)) + 2) % 24).padStart(2, '0')}${start.slice(2)}`;
		rows.push({ name: '', start, end, was: '' });
	}
	const missing = $derived([...new Set(used)].filter((n) => !ranges.some((r) => r.name === n)));
</script>

{#each rows as r, i (i)}
	{@const name = r.name.trim() || 'the new part'}
	<div class="se-part">
		<input bind:value={r.name} maxlength="40" placeholder="Morning" aria-label="Name of {r.was || 'the new part'}" onchange={() => leave(r.was ? `Changed ${name}.` : `Added ${name}.`)} />
		<span class="times">
			<input type="time" bind:value={r.start} aria-label="{name} starts" onblur={() => r.name.trim() && leave(`Changed ${name}.`)} />
			<input type="time" bind:value={r.end} aria-label="{name} ends" onblur={() => r.name.trim() && leave(`Changed ${name}.`)} />
		</span>
		<button type="button" class="quiet glyph" aria-label="Remove {name}" onclick={() => remove(i)}>×</button>
	</div>
{/each}
<div><button type="button" onclick={add}>+ Part</button></div>
{#if missing.length}
	<p class="meta muted">Still set for a part that is gone: {missing.map((n) => `${n} (${setFor(n)} ${setFor(n) === 1 ? 'habit' : 'habits'})`).join(', ')}.</p>
{/if}

<style>
	p {
		margin: 0;
	}
	.se-part {
		grid-template-columns: minmax(6rem, 1fr) auto auto;
	}
	.times {
		display: flex;
		gap: var(--space-tight);
	}
	.times input {
		width: 6.5rem;
	}
	@media (max-width: 26rem) {
		.se-part {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.times {
			order: 3;
			grid-column: 1 / -1;
		}
		.times input {
			flex: 1;
		}
	}
</style>
