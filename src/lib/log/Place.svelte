<script lang="ts">
	// One place in a log that is done in rows (sets): its line while it is folded; while it is open,
	// what is done above, the one open row, and what is still to come.
	import type { Snippet } from 'svelte';
	import MenuButton, { type Way } from '$lib/ui/MenuButton.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import { cap, difference, rowText, rowsName, rowsText, skippedName, unitOf, type Field, type RowState } from './run';

	interface LogField extends Field {
		step: number;
		required: boolean;
	}
	let {
		name,
		fields,
		sets,
		base,
		previous,
		head,
		recap,
		words = { one: 'set', many: 'sets' },
		open,
		folded,
		stage,
		toFinish,
		logged,
		menu,
		targetOf,
		onopen,
		onunfold,
		ondone,
		ontick,
		onvalue,
		onadd,
		onremove,
		onfinish,
		once,
		extra,
		text,
		body
	}: {
		name: string;
		fields: LogField[];
		sets: RowState[];
		/** What each row started with. */
		base: RowState[];
		/** What each row was last time. */
		previous: Record<string, unknown>[];
		/** The plan in words, under the name. */
		head: string;
		/** Last time in words, before anything is done here. */
		recap: string;
		words?: { one: string; many: string };
		/** The open row, when it is here. */
		open: number | null;
		folded: boolean;
		/** Logging, correcting a finished log, or only looking. */
		stage: 'run' | 'correct' | 'read';
		/** Nothing is left to log anywhere. */
		toFinish: boolean;
		/** The row that was just logged here; the act says so and takes no press for a moment. */
		logged: number | null;
		menu: (Way | '-')[];
		targetOf: (id: string) => number | undefined;
		onopen: (row: number | null) => void;
		onunfold: () => void;
		ondone: (row: number, keyboard: boolean) => void;
		ontick: (row: number, on: boolean) => void;
		onvalue: (row: number, id: string, v: unknown) => void;
		onadd: () => void;
		onremove: () => void;
		onfinish: () => void;
		/** Fields that are filled in once, not per row. */
		once?: Snippet;
		extra?: Snippet;
		/** What a row says, when its values stand elsewhere (the stations of a round). */
		text?: (row: number) => string;
		/** What the open row holds in place of fields. Such rows are the plan's: none are added here. */
		body?: Snippet<[number]>;
	} = $props();
	const textAt = (k: number) => (text ? text(k) : rowText(fields, sets[k].values));

	const id = $props.id();
	let ledger = $state(false);
	let all = $state(false);
	const SHOWN = 3;

	const done = $derived(sets.filter((s) => s.done));
	const left = $derived(sets.findIndex((s) => !s.done));
	const above = $derived(open === null ? [] : sets.slice(0, open));
	const below = $derived(open === null ? [] : sets.map((_, k) => k).slice(open + 1));
	const numbers = $derived(fields.filter((f) => ['number', 'count', 'duration'].includes(f.type)));
	const pills = $derived(fields.filter((f) => f.type === 'choice' && (f.choices?.length ?? 0) <= 7));
	const others = $derived(fields.filter((f) => !numbers.includes(f) && !pills.includes(f)));

	const deltas = (k: number) => numbers.map((f) => difference(sets[k].values[f.id], base[k]?.values[f.id] ?? previous[k]?.[f.id], unitOf(f))).filter(Boolean).join(', ');
	const lastText = (k: number) => (previous[k] ? rowText(fields, previous[k]) : '');
	const foldWords = $derived(
		left < 0 && sets.length
			? `✓ ${text ? `${sets.length} ${words.many}` : rowsText(fields, sets)}`
			: done.length
				? `${done.length} of ${sets.length} done${text ? '' : ` · next ${textAt(left)}`}`
				: head || `${sets.length} ${words.many}`
	);
	const ledgerWords = $derived.by(() => {
		const d = above.filter((s) => s.done);
		if (!d.length) return above.length ? `${cap(words.one)} ${above.map((_, k) => k + 1).join(', ')} not done` : recap;
		const k = above.findLastIndex((s) => s.done);
		return [rowsName(above, words.one, words.many), text ? '' : rowsText(fields, d), d.length <= 2 ? deltas(k) : '', skippedName(sets, words.one)].filter(Boolean).join(' · ');
	});
	const newest = $derived(above.findLastIndex((s) => s.done));

	/** Why a number differs from where it would start. */
	function caption(f: Field, k: number): string {
		const v = sets[k].values[f.id];
		const b = base[k]?.values[f.id];
		const d = difference(v, b, unitOf(f));
		if (d) {
			const from = sets[k].own?.includes(f.id) ? -1 : sets.findLastIndex((s, j) => j < k && s.own?.includes(f.id));
			return from >= 0 ? `${d}, as ${words.one} ${from + 1}` : d;
		}
		return f.prefill === 'target' && v != null && v === targetOf(f.id) ? 'Target' : '';
	}

	const act = $derived.by(() => {
		if (open === null) return null;
		const row = sets[open];
		if (logged !== null) return { kind: 'busy' as const, label: `Logged ${words.one} ${logged + 1}`, detail: '', primary: false };
		if (!row.done) return { kind: 'done' as const, label: `Done ${words.one} ${open + 1}`, detail: textAt(open), primary: true };
		if (stage === 'correct') return { kind: 'close' as const, label: 'Close', detail: '', primary: false };
		if (toFinish) return { kind: 'finish' as const, label: 'Go to Finish', detail: '', primary: false };
		return { kind: 'back' as const, label: left >= 0 ? `Back to ${words.one} ${left + 1}` : 'Go on', detail: '', primary: false };
	});
	function press(e: MouseEvent) {
		if (open === null || !act || act.kind === 'busy') return;
		// What is being typed counts.
		(document.activeElement as HTMLElement | null)?.matches('input') && (document.activeElement as HTMLElement).blur();
		if (act.kind === 'done') ondone(open, e.detail === 0);
		else if (act.kind === 'finish') onfinish();
		else onopen(null);
	}
	/** Enter goes to the next field, and from the last one to the act. */
	function next(e: KeyboardEvent) {
		const box = (e.target as HTMLElement).closest('.lg-open')!;
		const stops = [...box.querySelectorAll<HTMLElement>('input, select, .lg-act')];
		stops[stops.indexOf(e.target as HTMLElement) + 1]?.focus();
	}
</script>

{#snippet rowWords(k: number)}
	<span class="num"><span class="vh">{cap(words.one)} </span>{k + 1}</span>
					<span class="lg-press-text">
						<span class="lg-val"><bdi dir="ltr">{textAt(k) || '–'}</bdi></span>
						{#if sets[k].done ? deltas(k) : lastText(k)}<span class="label lg-line"><bdi dir="ltr">{sets[k].done ? deltas(k) : `Last ${lastText(k)}`}</bdi></span>{/if}
						{#if sets[k].done}<span class="vh">, done</span>{/if}
					</span>
{/snippet}

{#snippet row(k: number)}
	<li class="row lg-row" class:done={sets[k].done}>
		<div class="card link">
			<span class="slot"></span>
			<div class="content">
				{#if stage === 'read'}<div class="lg-press">{@render rowWords(k)}</div>
				{:else}<button type="button" class="lg-bare lg-press" onclick={() => onopen(k)}>{@render rowWords(k)}</button>{/if}
			</div>
			<div class="verb">
				{#if stage === 'read'}{sets[k].done ? '✓' : ''}
				{:else}<input type="checkbox" class="tick hit" checked={sets[k].done} aria-label="{cap(words.one)} {k + 1} of {name} done" onchange={(e) => ontick(k, e.currentTarget.checked)} />{/if}
			</div>
		</div>
	</li>
{/snippet}

{#if folded}
	<div class="card lg-head link">
		<span class="slot"></span>
		<div class="content">
			<h2 class="name lg-fold-h">
				<button aria-expanded="false" class="lg-bare lg-fold" type="button" onclick={onunfold}
					><span aria-hidden="true" class="chev">›</span><span class="lg-fold-text"><span>{name}</span> <span class="meta lg-fold-words"><bdi dir="ltr">{foldWords}</bdi></span></span></button
				>
			</h2>
		</div>
	</div>
{:else}
	<div class="card lg-head">
		<span class="slot"></span>
		<div class="content">
			<h2 class="name">{name}</h2>
			{#if head}<p class="meta-line"><bdi dir="ltr">{head}</bdi></p>{/if}
			{#if extra}{@render extra()}{/if}
		</div>
		{#if menu.length && stage !== 'read'}<div class="verb"><MenuButton class="quiet glyph hit lg-more" label="More for {name}" items={menu} /></div>{/if}
	</div>
	<div class="shelf lg-shelf">
		{#if open === null}
			<ul class="elist lg-above" data-mode="use" aria-label="{cap(words.many)} of {name}">
				{#each sets as _, k (k)}{@render row(k)}{/each}
			</ul>
		{:else}
			{#if above.length}
				<div class="lg-ledger">
					<button type="button" class="fold lg-ledger-fold" aria-expanded={ledger} aria-controls="{id}-above" aria-label="{above.length} {above.length === 1 ? words.one : words.many} above" onclick={() => (ledger = !ledger)}
						><span aria-hidden="true" class="chev">›</span></button
					>
					<button type="button" class="lg-bare lg-ledger-words" onclick={() => onopen(newest >= 0 ? newest : open! - 1)}><span class="label lg-words"><bdi dir="ltr">{ledgerWords}</bdi></span></button>
					{#if newest >= 0 && stage !== 'read'}
						<input type="checkbox" class="tick hit" checked aria-label="{cap(words.one)} {newest + 1} of {name} done" onchange={(e) => {
							e.currentTarget.checked = true;
							ontick(newest, false);
						}} />
					{/if}
				</div>
				<ul class="elist lg-above" id="{id}-above" hidden={!ledger} data-mode="use" aria-label="{cap(words.many)} of {name}, above">
					{#each above as _, k (k)}{@render row(k)}{/each}
				</ul>
			{:else if ledgerWords}
				<div class="lg-ledger lg-ledger-plain"><span class="label">{ledgerWords}</span></div>
			{/if}
			<div class="lg-slot">
				<div class="lg-open" role="group" aria-label="{cap(words.one)} {open + 1} of {name}" aria-current="step">
					<p class="lg-open-head">
						<span class="name">{cap(words.one)} {open + 1} of {sets.length}{sets[open].done ? ' · done' : ''}</span>
						{#if lastText(open)}<span class="label"><bdi dir="ltr">Last {lastText(open)}</bdi></span>{/if}
					</p>
					{#if body}
						{@render body(open)}
					{:else if numbers.length || pills.length || others.length}
						<div class="lg-fields">
							{#each numbers as f (f.id)}
								<div class="field">
									<span class="label">{f.name}{unitOf(f) ? ` (${unitOf(f)})` : ''}{f.required ? ', required' : ''}</span>
									<NumberField
										large
										value={sets[open].values[f.id] as number | null}
										step={f.step}
										unit={unitOf(f)}
										label="{f.name} for {name}, {words.one} {open + 1}"
										caption={caption(f, open)}
										disabled={stage === 'read'}
										onchange={(v) => onvalue(open!, f.id, v)}
										onenter={next}
									/>
								</div>
							{/each}
							{#each pills as f (f.id)}
								<div class="field lg-span" role="group" aria-label="{f.name} for {name}, {words.one} {open + 1}">
									<span class="label">{f.name}{f.required ? ', required' : ''}</span>
									<div class="chips">
										{#each f.choices ?? [] as c (c.id)}
											<button type="button" class="toggle" aria-pressed={sets[open].values[f.id] === c.id} onclick={() => onvalue(open!, f.id, sets[open!].values[f.id] === c.id ? null : c.id)}>{c.name}</button>
										{/each}
									</div>
								</div>
							{/each}
							{#each others as f (f.id)}
								<div class="field lg-span">
									{#if f.type === 'checkbox'}
										<label class="check"><input type="checkbox" class="tick" checked={!!sets[open].values[f.id]} onchange={(e) => onvalue(open!, f.id, e.currentTarget.checked)} /> {f.name}</label>
									{:else if f.type === 'choice'}
										<label class="label" for="{id}-{f.id}">{f.name}</label>
										<select id="{id}-{f.id}" value={sets[open].values[f.id] ?? ''} onchange={(e) => onvalue(open!, f.id, e.currentTarget.value || null)}>
											<option value=""></option>
											{#each f.choices ?? [] as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
										</select>
									{:else}
										<label class="label" for="{id}-{f.id}">{f.name}</label>
										<input id="{id}-{f.id}" value={String(sets[open].values[f.id] ?? '')} oninput={(e) => onvalue(open!, f.id, e.currentTarget.value)} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), next(e))} />
									{/if}
								</div>
							{/each}
						</div>
					{/if}
					{#if act && stage !== 'read'}
						<button type="button" class="lg-act" class:primary={act.primary} aria-busy={act.kind === 'busy'} aria-disabled={act.kind === 'busy'} onclick={press}>
							<span class="name">{act.label}<span class="vh"> of {name}{act.detail ? ',' : ''}</span></span>
							{#if act.detail}<span class="meta"><bdi dir="ltr">{act.detail}</bdi></span>{/if}
						</button>
					{/if}
				</div>
			</div>
			{#if below.length}
				<ul class="elist lg-below" data-mode="use" aria-label="{cap(words.many)} of {name}, still to come">
					{#each all ? below : below.slice(0, SHOWN) as k (k)}{@render row(k)}{/each}
				</ul>
				{#if below.length > SHOWN && !all}
					<button type="button" class="shelf-fold lg-more-rows" aria-expanded="false" onclick={() => (all = true)}><span class="chev" aria-hidden="true">›</span> {below.length - SHOWN} more {words.many}</button>
				{/if}
			{/if}
		{/if}
		{#if stage !== 'read' && !body}
			<div class="lg-foot">
				<button type="button" class="quiet hit" onclick={onadd}>Add {words.one}</button>
				{#if sets.length && !sets.at(-1)!.done}<button type="button" class="quiet hit" onclick={onremove}>Remove {words.one} {sets.length}</button>{/if}
			</div>
		{/if}
		{#if once}<div class="lg-once">{@render once()}</div>{/if}
	</div>
{/if}

<style>
	p,
	h2 {
		margin: 0;
	}
	.lg-open {
		scroll-margin-block: calc(var(--space-section) * 2) calc(var(--tabbar-clear) + var(--space-inline));
	}
</style>
