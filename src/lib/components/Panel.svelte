<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		description?: string;
		/** Right-aligned action area, e.g. a create button. */
		actions?: Snippet;
		/** Padding for the body; pass `p-0` when the body is a flush table. */
		bodyClass?: string;
		children: Snippet;
	}

	let { title, description, actions, bodyClass = 'p-5', children }: Props = $props();
</script>

<section
	class="overflow-hidden rounded-[var(--radius-box)] border border-border bg-bg-surface shadow-panel"
>
	{#if title}
		<div class="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
			<div class="min-w-0">
				<h2 class="text-[13.5px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
				{#if description}
					<p class="mt-1 text-[12px] leading-relaxed text-fg-muted">{description}</p>
				{/if}
			</div>
			{#if actions}
				<div class="flex shrink-0 flex-wrap items-center gap-2">
					{@render actions()}
				</div>
			{/if}
		</div>
	{/if}

	<div class={bodyClass}>
		{@render children()}
	</div>
</section>
