<script lang="ts">
	import { STATUS, type Status } from '$lib/status';
	let { status }: { status: Status } = $props();
</script>

<span class="tag" class:strong={STATUS[status].tone === 'strong'}>{STATUS[status].label}</span>
