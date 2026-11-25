<script lang="ts">
	import { untrack } from 'svelte';
	import TemplateSentence from '$lib/say/TemplateSentence.svelte';
	import { checkTemplate } from '$lib/template';
	import { runAction } from '$lib/toast.svelte';
	import EditChrome from '$lib/ui/EditChrome.svelte';
	import { weekdayNames } from '$lib/describe';
	import { shareForm, type ShareForm } from '$lib/share';
	import { blocked, normalize } from '$lib/rules/core';
	import { checkShare, shareRules } from '$lib/rules/share';

	let { data, form } = $props();
	const ctx = untrack(() => data.ctx);

	let f = $state<ShareForm>(
		untrack(() =>
			shareForm.parse({
				name: data.name,
				includeArea: !!data.ctx.area,
				includePool: data.ctx.pool > 0,
				includeHowTo: data.ctx.howTo > 0,
				suggestReminder: data.ctx.remind
			})
		)
	);
	let equipment = $state('');

	/** The form as it goes out: options that can't apply are cleared, as on the server. */
	const clean = $derived(normalize(shareRules, { ...$state.snapshot(f), equipment: equipment.split(',').map((x) => x.trim()).filter(Boolean) }, ctx).form);
	const issues = $derived(checkShare(clean, ctx));
	const blocking = $derived(issues.filter((i) => i.severity === 'block'));
	const why = (path: Parameters<typeof blocked<ShareForm, typeof ctx>>[2]) => blocked(shareRules, clean, path, ctx)?.reason ?? null;

	const metricLabel = (m: (typeof data.metrics)[number]) =>
		`${m.task}: ${m.name}${m.target !== null ? ` (target ${m.target}${m.unit ? ' ' + m.unit : ''})` : ''}`;

	function addNumber() {
		const first = data.metrics.find((m) => !f.numbers.some((n) => n.metrics.includes(m.id)));
		f.numbers.push({
			label: first ? `Your starting ${first.name.toLowerCase()}` : 'Your starting number',
			unit: first?.unit ?? '',
			metrics: first ? [first.id] : [],
			default: first?.target ?? 0,
			scale: true
		});
	}
	function toggleMetric(i: number, id: string) {
		const n = f.numbers[i];
		n.metrics = n.metrics.includes(id) ? n.metrics.filter((x) => x !== id) : [...n.metrics, id];
		// The first field picked suggests the starting number and unit.
		if (n.metrics.length === 1 && n.metrics[0] === id) {
			const m = data.metrics.find((x) => x.id === id);
			if (m?.target !== null && m?.target !== undefined && !n.default) n.default = m.target;
			if (m && !n.unit) n.unit = m.unit;
		}
	}
	// The file as it would go out, read the way the other person's page reads it.
	let previewText = $state('');
	const preview = $derived.by(() => {
		const c = previewText ? checkTemplate(previewText) : null;
		return c?.ok ? c.tpl : null;
	});
	$effect(() => {
		const share = JSON.stringify(clean);
		if (blocking.length) return;
		const t = setTimeout(async () => {
			const r = await runAction<{ file: string }>('?/preview', { share });
			if (r.ok && r.data) previewText = r.data.file;
		}, 400);
		return () => clearTimeout(t);
	});
	const dayList = (days: number[]) => days.map((d) => weekdayNames[d]).join(', ');
</script>

<svelte:head><title>Share {data.name} · ittracks</title></svelte:head>

<EditChrome title="Share as a template" modes={['use']} back={{ href: `/habits/${data.id}`, label: data.name }} hints={{ use: 'A file someone else can add, with the questions you ask here. Your logs stay here, and a file you have sent stays sent.' }} />

<form method="POST" action="/habits/{data.id}/template.json" class="stack" onsubmit={(e) => blocking.length && e.preventDefault()}>
	<input type="hidden" name="share" value={JSON.stringify(clean)} />

	<section class="card stack">
		<h2>About it</h2>
		<label>Template name <input bind:value={f.name} maxlength="120" required /></label>
		<label>Description <textarea bind:value={f.description} rows="3" maxlength="2000" placeholder="Who it's for and how it works"></textarea></label>
		<details>
			<summary class="small-text">Gallery details (optional)</summary>
			<div class="stack" style="margin-top: 0.5rem">
				<label>Category <input bind:value={f.category} maxlength="40" placeholder="Gym, Learning, Health…" /></label>
				<div class="row">
					<label class="grow"
						>Days a week
						<input type="number" min="0" max="7" value={f.daysPerWeek ?? ''} oninput={(e) => (f.daysPerWeek = e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} /></label
					>
					<label class="grow"
						>Minutes a day
						<input type="number" min="0" max="600" value={f.minutesPerDay ?? ''} oninput={(e) => (f.minutesPerDay = e.currentTarget.value === '' ? null : Math.round(Number(e.currentTarget.value)))} /></label
					>
				</div>
				<label>Equipment, separated by commas <input bind:value={equipment} placeholder="Barbell, bench" /></label>
			</div>
		</details>
	</section>

	<section class="card stack">
		<h2>What travels with it</h2>
		{#if data.inside.length}
			<div>
				<span>{data.inside.length === 1 ? 'The habit inside it' : `The ${data.inside.length} habits inside it`}, with their schedules and Tasks</span>
				<ul class="inside muted small-text">
					{#each data.inside as h, i (i)}<li style:margin-left="{(h.depth - 1) * 1}rem">{h.name}</li>{/each}
				</ul>
			</div>
		{/if}
		<label class="opt check"
			><input type="checkbox" class="pick" bind:checked={f.includeArea} disabled={!!why('includeArea')} />
			<span>Area{ctx.area ? ` "${ctx.area}"` : ''}, and the Areas of its Tasks{#if why('includeArea')}<br /><span class="muted small-text">{why('includeArea')}</span>{/if}</span></label
		>
		<label class="opt check"
			><input type="checkbox" class="pick" bind:checked={f.includePool} disabled={!!why('includePool')} />
			<span
				>{ctx.pool === 1 ? 'The Task' : ctx.pool ? `The ${ctx.pool} Tasks` : 'Tasks'} the auto-filled slots pick from{#if data.poolNames.length}<br /><span class="muted small-text"
						>{data.poolNames.slice(0, 6).join(', ')}{data.poolNames.length > 6 ? ` and ${data.poolNames.length - 6} more` : ''}</span
					>{:else if why('includePool')}<br /><span class="muted small-text">{why('includePool')}</span>{/if}</span
			></label
		>
		<label class="opt check"
			><input type="checkbox" class="pick" bind:checked={f.includeNote} disabled={!!why('includeNote')} />
			<span
				>The habit's own note<br /><span class="muted small-text"
					>{why('includeNote') ?? 'Off unless you tick it: notes are private, and yours may say why the habit matters to you.'}</span
				></span
			></label
		>
		<label class="opt check"
			><input type="checkbox" class="pick" bind:checked={f.includeHowTo} disabled={!!why('includeHowTo')} />
			<span
				>How to notes of its Tasks<br /><span class="muted small-text"
					>{why('includeHowTo') ??
						`${ctx.howTo === 1 ? '1 Task has' : `${ctx.howTo} Tasks have`} notes on how to do it. They help whoever adds the template.`}</span
				></span
			></label
		>
		<label class="opt check"
			><input type="checkbox" class="pick" bind:checked={f.suggestReminder} disabled={!!why('suggestReminder')} />
			<span
				>Suggest turning the reminder on<br /><span class="muted small-text"
					>{why('suggestReminder') ?? 'The person adding it is asked; reminders are never turned on by themselves.'}</span
				></span
			></label
		>
	</section>

	<section class="card stack">
		<h2>Questions</h2>
		<p class="muted small-text" style="margin: 0">Asked when someone adds the template, so it fits them. Each has your setting as its answer to start with.</p>

		{#if data.direction === 'build'}
			<label class="opt check"
				><input type="checkbox" class="pick" bind:checked={f.askDays} disabled={!!why('askDays')} />
				<span
					>Ask which days{#if why('askDays')}<br /><span class="muted small-text">{why('askDays')}</span>{:else}<br /><span class="muted small-text"
							>{data.schedule}. Starts as {dayList(ctx.days)}.</span
						>{/if}</span
				></label
			>
			{#if clean.askDays}<label class="indent">Question <input bind:value={f.daysLabel} maxlength="200" /></label>{/if}

			<label class="opt check"
				><input type="checkbox" class="pick" bind:checked={f.askTime} />
				<span>Ask what time<br /><span class="muted small-text">Sets the time of day. Starts as {ctx.time ?? '07:00'}.</span></span></label
			>
			{#if clean.askTime}<label class="indent">Question <input bind:value={f.timeLabel} maxlength="200" /></label>{/if}

			{#each f.numbers as n, i (i)}
				<fieldset class="card stack number">
					<legend>Starting number {f.numbers.length > 1 ? i + 1 : ''}</legend>
					<label>Question <input bind:value={n.label} maxlength="200" placeholder="Your starting squat weight" /></label>
					<div class="row">
						<label class="grow">Starts as <input type="number" step="any" bind:value={n.default} /></label>
						<label class="grow">Unit <input bind:value={n.unit} maxlength="20" /></label>
					</div>
					<div>
						<span class="muted small-text">Sets the target of</span>
						{#each data.metrics as m (m.id)}
							<label class="opt check"><input type="checkbox" class="pick" checked={n.metrics.includes(m.id)} onchange={() => toggleMetric(i, m.id)} /> <span>{metricLabel(m)}</span></label>
						{/each}
					</div>
					<label class="opt check"
						><input type="checkbox" class="pick" bind:checked={n.scale} />
						<span
							>In proportion<br /><span class="muted small-text"
								>{n.scale
									? 'Every target moves by the same share as the answer, so a lighter day stays lighter. Minimum and Stretch move with it.'
									: 'The answer becomes the target everywhere. Minimum and Stretch still move with it.'}</span
							></span
						></label
					>
					<button type="button" class="small" onclick={() => f.numbers.splice(i, 1)}>Remove this question</button>
				</fieldset>
			{/each}
			{#if data.metrics.length}
				<button type="button" class="small" onclick={addNumber} disabled={f.numbers.length >= 8}>+ Ask for a starting number</button>
			{:else}
				<p class="muted small-text" style="margin: 0">No fixed Task has a number to ask about.</p>
			{/if}
		{:else}
			<p class="muted small-text" style="margin: 0">A habit to break has no schedule or targets to ask about.</p>
		{/if}
	</section>

	{#if issues.length}
		<ul class="issues" role="status">
			{#each issues as i (i.reason)}<li class={i.severity === 'block' ? 'error' : 'muted'}>{i.reason}</li>{/each}
		</ul>
	{/if}
	{#if form?.error}<p class="error">{form.error}</p>{/if}
	<div class="l-cluster">
		<button class="primary hit" aria-disabled={blocking.length > 0}>Download the template</button>
		<button class="hit" formaction="?/save" aria-disabled={blocking.length > 0}>Save to my Gallery</button>
	</div>
</form>

{#if preview}
	<section class="ob-sec" aria-label="What the other person sees">
		<h2 class="section-title">What the other person sees</h2>
		<div inert>{#key previewText}<TemplateSentence tpl={preview} today={data.today} libraryNames={[]} />{/key}</div>
	</section>
{/if}

<style>
	h2 {
		margin: 0;
		font-size: 1.05rem;
	}
	.opt {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		color: var(--text);
	}
	.opt input {
		margin-top: 0.2rem;
	}
	.indent {
		margin-left: 1.6rem;
	}
	.number {
		border: 1px solid var(--border);
	}
	.issues {
		margin: 0;
		padding-left: 1.2rem;
	}
	.small-text {
		font-size: 0.85rem;
	}
	.inside {
		margin: 0.2rem 0 0;
		padding-left: 1.1rem;
	}
</style>
