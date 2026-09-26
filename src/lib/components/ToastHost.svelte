<script lang="ts">
	import { feedback } from '$lib/stores/feedback.svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	const meta = {
		info: { icon: 'activity', ring: 'text-info-ink bg-info-soft', bar: 'bg-info' },
		success: { icon: 'check', ring: 'text-success-ink bg-success-soft', bar: 'bg-success' },
		warning: { icon: 'alert', ring: 'text-warning-ink bg-warning-soft', bar: 'bg-warning' },
		error: { icon: 'alert', ring: 'text-error-ink bg-error-soft', bar: 'bg-error' }
	} as const satisfies Record<string, { icon: IconName; ring: string; bar: string }>;

	// Keep at most a few notices on screen at once.
	const visible = $derived(feedback.items.slice(-3));
</script>

<div
	class="pointer-events-none fixed top-4 right-4 z-[2000] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
>
	{#each visible as item (item.id)}
		<div
			class="toast pointer-events-auto flex items-start gap-2.5 overflow-hidden rounded-[var(--radius-box)] border border-border bg-bg-surface p-3 pl-3.5 shadow-popover"
		>
			<span
				class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full {meta[
					item.type
				].ring}"
			>
				<Icon name={meta[item.type].icon} size={15} />
			</span>
			<p class="min-w-0 flex-1 pt-1 text-[12.5px] leading-snug text-fg">{item.message}</p>
			<button
				type="button"
				aria-label="关闭提示"
				onclick={() => feedback.dismiss(item.id)}
				class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-bg-hover hover:text-fg"
			>
				<Icon name="close" size={13} />
			</button>
		</div>
	{/each}
</div>

<style>
	.toast {
		animation: toast-in 200ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(-8px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation: none;
		}
	}
</style>
