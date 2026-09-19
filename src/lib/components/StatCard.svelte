<script lang="ts">
	interface Props {
		label: string;
		value: string | number | null;
		/** Small secondary line under the label. */
		hint?: string;
	}

	let { label, value, hint }: Props = $props();
</script>

<div class="rounded-[var(--radius-box)] border border-white/5 bg-bg-surface px-5 py-4 text-center">
	<div class="text-2xl font-semibold text-primary">
		{#if value === null}
			<span class="text-gray-600">-</span>
		{:else}
			{value}
		{/if}
	</div>
	<div class="mt-1 text-[11px] tracking-wider text-gray-500 uppercase">{label}</div>
	{#if hint}
		<div class="mt-0.5 text-[11px] text-gray-600">{hint}</div>
	{/if}
</div>
