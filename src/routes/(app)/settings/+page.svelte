<script lang="ts">
	let { data } = $props();

	const shortDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	const list = (xs: string[], max = 3) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', '));
	const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

	const day = $derived(
		[
			data.dayStart && data.dayStart !== '00:00' ? `Starts at ${data.dayStart}` : 'Starts at midnight',
			data.ranges.length ? list(data.ranges) : 'no parts of the day yet'
		].join(' · ')
	);
	const vacation = $derived.by(() => {
		const v = data.vacation;
		if (!v) return 'None planned';
		const when = v.start <= data.today ? `On vacation until ${shortDate(v.end)}` : `${shortDate(v.start)} to ${shortDate(v.end)}`;
		return data.moreVacations ? `${when}, and ${plural(data.moreVacations, 'more')}` : when;
	});
	const views = $derived(
		`${data.template} · opens on ${data.startPage}${data.viewWarnings ? ` · ${plural(data.viewWarnings, 'thing', 'things')} to check` : ''}`
	);
	const features = $derived(data.hidden ? `${data.features - data.hidden} of ${data.features} in use` : 'All in use');
	const editor = $derived(
		[
			data.guidedSetup ? 'Guided setup for new habits' : 'New habits open the full editor',
			data.showAllSections ? 'every section shown' : null,
			`weights in ${data.weightUnit}`
		]
			.filter(Boolean)
			.join(' · ')
	);
	const reminders = $derived(data.devices ? `On for ${plural(data.devices, 'device')}` : 'Off on every device');
</script>

<svelte:head><title>Settings · ittracks</title></svelte:head>

<header class="bar">
	<h1>Settings</h1>
</header>

{#snippet row(href: string, title: string, line: string)}
	<li>
		<a class="card" {href}>
			<div class="setting">
				<div class="grow">
					<strong>{title}</strong>
					<div class="muted small-text">{line}</div>
				</div>
				<span class="muted" aria-hidden="true">›</span>
			</div>
		</a>
	</li>
{/snippet}

<h2>Your day</h2>
<ul class="list">
	{@render row('/settings/day', 'Day and parts of the day', day)}
	{@render row('/settings/vacation', 'Vacation', vacation)}
</ul>

<h2>Habits and Tasks</h2>
<ul class="list">
	{@render row('/settings/areas', 'Areas', data.areas.length ? list(data.areas, 4) : 'No Areas yet')}
	{@render row('/settings/editor', 'New habits and units', editor)}
</ul>

<h2>Look and layout</h2>
<ul class="list">
	{@render row('/settings/views', 'View template and start page', views)}
	{@render row('/settings/features', 'Features', features)}
</ul>

<h2>Stats</h2>
<ul class="list">
	{@render row(
		'/settings/stats',
		'Your measures and formulas',
		`${data.stats.measures ? plural(data.stats.measures, 'measure') : 'No measures of your own yet'} · e1RM by ${data.stats.e1rm}`
	)}
</ul>

<h2>Notifications</h2>
<ul class="list">
	{@render row('/settings/reminders', 'Reminders', reminders)}
</ul>

<h2>Data</h2>
<ul class="list">
	{@render row('/settings/data', 'Templates and shortcuts', 'Export habits, import templates, quick-log links')}
</ul>

<h2>Account</h2>
<ul class="list">
	{@render row('/settings/account', 'Account and password', `Signed in as ${data.username}`)}
</ul>

<form method="POST" action="/logout" style="margin-top: 1.5rem"><button class="danger">Log out</button></form>

<style>
	.setting {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.small-text {
		font-size: 0.85rem;
	}
</style>
