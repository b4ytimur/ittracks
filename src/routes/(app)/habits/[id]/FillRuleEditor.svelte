<script lang="ts">
	// Edits a Fill rule: Tags a Task must have, must not have, and should preferably have.
	interface Rule {
		must: Record<string, number>;
		mustNot: Record<string, number>;
		prefer: string[];
	}
	let { rule = $bindable(), tags }: { rule: Rule; tags: string[] } = $props();

	let mustTag = $state('');
	let mustLevel = $state(2);
	let notTag = $state('');
	let notLevel = $state(0);
	let preferTag = $state('');

	const levelWord = ['none', 'low', 'medium', 'high'];

	function addMust() {
		if (mustTag) rule.must[mustTag] = mustLevel;
		mustTag = '';
	}
	function addNot() {
		if (notTag) rule.mustNot[notTag] = notLevel;
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
					<button type="button" class="chip small on" onclick={() => remove(rule.must, t)} title="Remove"
						>{t} {lvl === 3 ? 'high' : `at least ${levelWord[lvl]}`} ✕</button
					>
				{/each}
			</div>
			<div class="row" style="margin-top: 0.4rem">
				<select class="grow" bind:value={mustTag} aria-label="Tag">
					<option value="">Choose a tag</option>
					{#each tags as t (t)}<option value={t}>{t}</option>{/each}
				</select>
				<select bind:value={mustLevel} aria-label="Minimum level" style="width: auto">
					<option value={1}>at least low</option>
					<option value={2}>at least medium</option>
					<option value={3}>high</option>
				</select>
				<button type="button" class="small" onclick={addMust}>Add</button>
			</div>
		</div>

		<div>
			<strong>Must not have</strong>
			<div class="chips">
				{#each Object.entries(rule.mustNot) as [t, lvl] (t)}
					<button type="button" class="chip small" onclick={() => remove(rule.mustNot, t)} title="Remove"
						>{t} {lvl === 0 ? 'not at all' : `at most ${levelWord[lvl]}`} ✕</button
					>
				{/each}
			</div>
			<div class="row" style="margin-top: 0.4rem">
				<select class="grow" bind:value={notTag} aria-label="Tag">
					<option value="">Choose a tag</option>
					{#each tags as t (t)}<option value={t}>{t}</option>{/each}
				</select>
				<select bind:value={notLevel} aria-label="Maximum level" style="width: auto">
					<option value={0}>not at all</option>
					<option value={1}>at most low</option>
					<option value={2}>at most medium</option>
				</select>
				<button type="button" class="small" onclick={addNot}>Add</button>
			</div>
		</div>

		<div>
			<strong>Prefer</strong>
			<div class="chips">
				{#each rule.prefer as t, i (t)}
					<button type="button" class="chip small" onclick={() => rule.prefer.splice(i, 1)} title="Remove"
						>{t} ✕</button
					>
				{/each}
			</div>
			<div class="row" style="margin-top: 0.4rem">
				<select class="grow" bind:value={preferTag} aria-label="Tag">
					<option value="">Choose a tag</option>
					{#each tags as t (t)}<option value={t}>{t}</option>{/each}
				</select>
				<button type="button" class="small" onclick={addPrefer}>Add</button>
			</div>
		</div>
	{/if}
</div>
