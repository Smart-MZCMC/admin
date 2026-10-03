<script lang="ts">
	import { fly } from 'svelte/transition';
	import { toastTransition, watchReducedMotion } from '$lib/overlay-motion';
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

	// reduced-motion 只能在 JS 里判断：svelte/transition 写的是 JS 驱动的内联样式，
	// app.css 里的 @media (prefers-reduced-motion: reduce) 对它无效。
	let reduced = $state(false);
	$effect(() => watchReducedMotion((value) => (reduced = value)));

	// 提示条比弹窗轻：120ms、只位移不缩放。缩放/回弹会让「路过的信息」抢注意力。
	let motion = $derived(toastTransition(reduced));
</script>

<div
	class="pointer-events-none fixed top-4 right-4 z-[2000] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
>
	{#each visible as item (item.id)}
		<div
			transition:fly={motion}
			class="pointer-events-auto flex items-start gap-2.5 overflow-hidden rounded-[var(--radius-box)] border border-border bg-bg-surface p-3 pl-3.5 shadow-popover"
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
