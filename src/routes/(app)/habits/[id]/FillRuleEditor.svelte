<script lang="ts">
	// Edits a Fill rule: Tags a Task must have, must not have, and should preferably have.
	import { groups } from '$lib/groupings-here';

	interface Rule {
		must: Record<string, number>;
		mustNot: Record<string, number>;
		prefer: string[];
	}
	let { rule = $bindable(), tags }: { rule: Rule; tags: string[] } = $props();

	let mustTag = $state('');
	let mustLevel = $state<number | null>(null);
	let notTag = $state('');
	let notLevel = $state<number | null>(null);
	let preferTag = $state('');

	/** A tag's levels, weakest first; the one a Task already has stays even when it is off the list. */
	const levelsOf = (tag: string) => groups().of(tag).levels.filter((l) => !l.off).reverse();
	const strongest = (tag: string, level: number) => groups().rank(tag, level) >= groups().of(tag).levels.length;
	const middle = (tag: string) => levelsOf(tag)[Math.floor(levelsOf(tag).length / 2)]?.id ?? 1;
	const name = (tag: string, level: number) => groups().levelName(tag, level);
	const must = $derived(levelsOf(mustTag).some((l) => l.id === mustLevel) ? mustLevel! : middle(mustTag));
	const not = $derived(levelsOf(notTag).slice(0, -1).some((l) => l.id === notLevel) ? notLevel! : 0);

	function addMust() {
		if (mustTag) rule.must[mustTag] = must;
		mustTag = '';
	}
	function addNot() {
		if (notTag) rule.mustNot[notTag] = not;
		notTag = '';
	}
	function addPrefer() {
		if (preferTag && !rule.prefer.includes(preferTag)) rule.prefer.push(preferTag);
		preferTag = '';
	}
	function remove(map: Record<string, number>, key: string) {
		delete map[key];
	}
</script>

<div class="stack">
	<p class="muted" style="margin: 0">
		Picks a Task from your Library each time. You can reroll or swap it on the day.
	</p>
	{#if tags.length === 0}
		<p class="muted">Add Tags to your Tasks in the Library to use auto-filled slots.</p>
	{:else}
		<div>
			<strong>Must have</strong>
			<div class="chips">
				{#each Object.entries(rule.must) as [t, lvl] (t)}
					<button type="button" class="toggle" onclick={() => remove(rule.must, t)} aria-label="Remove {t}"
						>{t} {strongest(t, lvl) ? name(t, lvl) : `at least ${name(t, lvl)}`} ✕</button
					>
				{/each}
			</div>
			<div class="row" style="margin-top: var(--space-inline)">
				<select class="grow" bind:value={mustTag} aria-label="Tag">
					<option value="">Choose a tag</option>
					{#each tags as t (t)}<option value={t}>{t}</option>{/each}
				</select>
				<select bind:value={() => must, (v) => (mustLevel = v)} aria-label="Minimum level" style="width: auto">
					{#each levelsOf(mustTag) as l, i (l.id)}<option value={l.id}>{i === levelsOf(mustTag).length - 1 ? l.name : `at least ${l.name}`}</option>{/each}
				</select>
				<button type="button" onclick={addMust}>Add</button>
			</div>
		</div>

		<div>
			<strong>Must not have</strong>
			<div class="chips">
				{#each Object.entries(rule.mustNot) as [t, lvl] (t)}
					<button type="button" class="toggle" onclick={() => remove(rule.mustNot, t)} aria-label="Remove {t}"
						>{t} {lvl === 0 ? 'not at all' : `at most ${name(t, lvl)}`} ✕</button
					>
				{/each}
			</div>
			<div class="row" style="margin-top: var(--space-inline)">
				<select class="grow" bind:value={notTag} aria-label="Tag">
					<option value="">Choose a tag</option>
					{#each tags as t (t)}<option value={t}>{t}</option>{/each}
				</select>
				<select bind:value={() => not, (v) => (notLevel = v)} aria-label="Maximum level" style="width: auto">
					<option value={0}>not at all</option>
					{#each levelsOf(notTag).slice(0, -1) as l (l.id)}<option value={l.id}>at most {l.name}</option>{/each}
				</select>
				<button type="button" onclick={addNot}>Add</button>
			</div>
		</div>

		<div>
			<strong>Prefer</strong>
			<div class="chips">
				{#each rule.prefer as t, i (t)}
					<button type="button" class="toggle" onclick={() => rule.prefer.splice(i, 1)} aria-label="Remove {t}"
						>{t} ✕</button
					>
				{/each}
			</div>
			<div class="row" style="margin-top: var(--space-inline)">
				<select class="grow" bind:value={preferTag} aria-label="Tag">
					<option value="">Choose a tag</option>
					{#each tags as t (t)}<option value={t}>{t}</option>{/each}
				</select>
				<button type="button" onclick={addPrefer}>Add</button>
			</div>
		</div>
	{/if}
</div>
