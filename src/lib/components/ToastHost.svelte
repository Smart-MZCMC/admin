<script lang="ts">
	import { Toast } from 'stdf';
	import { feedback } from '$lib/stores/feedback.svelte';

	const typeMap = {
		info: 'info',
		success: 'success',
		warning: 'warning',
		error: 'error'
	} as const;

	// Keep at most a few notices on screen at once.
	const visible = $derived(feedback.items.slice(-3));
</script>

{#each visible as item (item.id)}
	<Toast
		visible={true}
		message={item.message}
		type={typeMap[item.type]}
		duration={3000}
		position="top"
		py="40"
		outDuration={200}
		onclose={() => feedback.dismiss(item.id)}
	/>
{/each}
