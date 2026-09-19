<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		/** Right-aligned action area, e.g. a create button. */
		actions?: Snippet;
		children: Snippet;
	}

	let { title, description, actions, children }: Props = $props();
</script>

<section
	class="rounded-[var(--radius-box)] border border-white/5 bg-bg-surface p-5 transition-colors hover:border-primary/15 md:p-6"
>
	<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="text-[15px] font-medium text-text-dark">{title}</h2>
			{#if description}
				<p class="mt-1 text-[12px] text-gray-500">{description}</p>
			{/if}
		</div>
		{#if actions}
			<div class="flex flex-wrap items-center gap-2">
				{@render actions()}
			</div>
		{/if}
	</div>

	{@render children()}
</section>
