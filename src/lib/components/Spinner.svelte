<script lang="ts">
	interface Props {
		/** Optional caption under the spinner. */
		label?: string;
	}

	let { label }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center gap-3 py-10">
	<span class="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary"
	></span>
	{#if label}
		<span class="text-[12px] text-fg-muted">{label}</span>
	{/if}
</div>
