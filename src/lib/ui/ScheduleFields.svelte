<script lang="ts">
	// The fields of a schedule with days of its own: fixed weekdays, N times a week or month,
	// every N days, or a rotation of Variants. The habit's own schedule and each of its phases
	// are this same component, so the two can't drift apart.
	//
	// `kind` is what the "How often" picker shows. The page can add its own choices (`more`,
	// such as phases or a group); while one of those is picked, `value` keeps the last schedule
	// of days of its own, and the page renders the rest.
	import type { PlainScheduleForm } from '$lib/forms';
	import { weekdayNames } from '$lib/describe';
	import { fitVariants, isPlainKind, plainOfKind, type PlainKind } from './schedule';

	let {
		value = $bindable(),
		kind = $bindable(value.kind),
		variants,
		more = [],
		subset = false,
		start,
		showStart = true,
		label = 'How often'
	}: {
		value: PlainScheduleForm;
		kind?: string;
		variants: { id: string; name: string }[];
		/** More choices for the picker, after the four kinds of days of its own. */
		more?: { value: string; label: string }[];
		/**
		 * Inside a phase: a rotation picks which Variants take part. Otherwise every Variant
		 * takes part, in the order the habit lists them.
		 */
		subset?: boolean;
		/** The day a new every-N-days schedule or rotation starts on. */
		start: string;
		/** Show the schedule's own start date (a phase starts on the phase's first day instead). */
		showStart?: boolean;
		label?: string;
	} = $props();

	/** The last schedule of each kind, so switching back keeps what was set. */
	const memo = new Map<string, PlainScheduleForm>();

	function pick(next: string) {
		if (isPlainKind(value.kind)) memo.set(value.kind, $state.snapshot(value));
		kind = next;
		if (isPlainKind(next) && next !== value.kind)
			value = fitVariants(memo.get(next) ?? plainOfKind(next as PlainKind, $state.snapshot(value), variants, start), variants, !subset);
	}

	const many = $derived(variants.length > 1);
	const shown = $derived(isPlainKind(kind));

	function toggleWeekday(d: number) {
		if (value.kind !== 'rotation') return;
		value.weekdays = value.weekdays.includes(d) ? value.weekdays.filter((x) => x !== d) : [...value.weekdays, d].sort();
	}
	const inRotation = (id: string) => value.kind === 'rotation' && value.order.some((o) => o.variantId === id);
	function toggleInRotation(id: string) {
		if (value.kind !== 'rotation') return;
		const on = inRotation(id);
		if (on && value.order.length === 1) return;
		const rest = new Map(value.order.map((o) => [o.variantId, o.restDays]));
		const ids = variants.map((v) => v.id).filter((v) => (v === id ? !on : rest.has(v)));
		value.order = ids.map((v) => ({ variantId: v, restDays: rest.get(v) ?? 1 }));
	}
	const restOf = (id: string) => (value.kind === 'rotation' ? (value.order.find((o) => o.variantId === id)?.restDays ?? 1) : 1);
	function setRest(id: string, n: number) {
		if (value.kind !== 'rotation') return;
		const rest = new Map(value.order.map((o) => [o.variantId, o.restDays]));
		rest.set(id, n);
		// Every Variant shown takes part: a Variant added since keeps its place in the order.
		value.order = rotating.map((v) => ({ variantId: v.id, restDays: rest.get(v.id) ?? 1 }));
	}
	const rotating = $derived(value.kind === 'rotation' ? variants.filter((v) => inRotation(v.id) || !subset) : []);
</script>

<label
	>{label}
	<select value={kind} onchange={(e) => pick(e.currentTarget.value)}>
		<option value="weekly">On fixed weekdays</option>
		<option value="frequency">A number of times per week or month</option>
		<option value="interval">Every few days</option>
		<option value="rotation">Rotate through Variants</option>
		{#each more as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
	</select>
</label>

{#if shown && value.kind === 'weekly'}
	{#each weekdayNames as day, d (day)}
		<div class="row">
			<span style="width: 3rem">{day}</span>
			<select
				class="grow"
				value={value.days[d] ?? ''}
				onchange={(e) => {
					if (value.kind !== 'weekly') return;
					const v = e.currentTarget.value;
					const days = { ...value.days };
					if (v) days[d] = v;
					else delete days[d];
					value.days = days;
				}}
				aria-label="Variant on {day}"
			>
				<option value="">Rest</option>
				{#each variants as v (v.id)}<option value={v.id}>{many ? v.name : 'Do it'}</option>{/each}
			</select>
		</div>
	{/each}
{:else if shown && value.kind === 'frequency'}
	<div class="row">
		<label style="width: 6rem">Times <input type="number" min="1" max="31" bind:value={value.times} /></label>
		<label class="grow"
			>Per
			<select bind:value={value.period}>
				<option value="week">week</option>
				<option value="month">month</option>
			</select>
		</label>
	</div>
{:else if shown && value.kind === 'interval'}
	<div class="row">
		<label style="width: 8rem">Every N days <input type="number" min="1" max="365" bind:value={value.every} /></label>
		{#if showStart}<label class="grow">Starting <input type="date" bind:value={value.start} /></label>{/if}
	</div>
{:else if shown && value.kind === 'rotation'}
	<label
		>Rotate by
		<select bind:value={value.step}>
			<option value="variant">Variant, with rest days between them</option>
			<option value="week">Week: a different Variant each week</option>
		</select>
	</label>
	{#if subset && many}
		<span class="muted small-text">Variants in this rotation</span>
		<div class="chips" role="group" aria-label="Variants in this rotation">
			{#each variants as v (v.id)}
				<button type="button" class="toggle" aria-pressed={inRotation(v.id)} onclick={() => toggleInRotation(v.id)}>{v.name}</button>
			{/each}
		</div>
	{/if}
	{#if value.step === 'variant'}
		{#each rotating as v (v.id)}
			<div class="row">
				<span class="grow">After {v.name}, rest</span>
				<input
					type="number"
					min="0"
					max="30"
					style="width: 5rem"
					value={restOf(v.id)}
					oninput={(e) => setRest(v.id, Number(e.currentTarget.value))}
					aria-label="Rest days after {v.name}"
				/>
				<span>days</span>
			</div>
		{/each}
		<fieldset class="card">
			<legend class="muted">If you miss a day</legend>
			<label style="color: var(--ink)"><input type="radio" bind:group={value.onMiss} value="wait" /> Wait: the Variant stays due until you do it</label>
			<label style="color: var(--ink)"><input type="radio" bind:group={value.onMiss} value="skip" /> Skip ahead to the next Variant</label>
		</fieldset>
	{:else}
		<div class="chips" role="group" aria-label="Training days">
			{#each weekdayNames as day, d (day)}
				<button type="button" class="toggle" aria-pressed={value.weekdays.includes(d)} onclick={() => toggleWeekday(d)}>{day}</button>
			{/each}
		</div>
		<p class="muted">Variants take turns week by week, in the order listed above.</p>
	{/if}
	{#if showStart}<label>Starting <input type="date" bind:value={value.start} /></label>{/if}
{/if}

{#if shown && (value.kind === 'frequency' || value.kind === 'interval') && many}
	<label
		>Variant
		<!-- A Variant that is gone saves as the first one, so it shows as the first one too. -->
		<select
			value={variants.some((v) => 'variantId' in value && v.id === value.variantId) ? value.variantId : variants[0]?.id}
			onchange={(e) => 'variantId' in value && (value.variantId = e.currentTarget.value)}
		>
			{#each variants as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
		</select>
	</label>
{/if}
