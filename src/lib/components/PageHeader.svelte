<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		/** Right-aligned primary actions. */
		actions?: Snippet;
	}

	let { title, description, actions }: Props = $props();
</script>

<header class="mb-5 flex flex-wrap items-start justify-between gap-4">
	<div class="min-w-0">
		<h1 class="text-[19px] leading-tight font-semibold tracking-[-0.015em] text-fg">{title}</h1>
		{#if description}
			<p class="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex shrink-0 flex-wrap items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</header>
