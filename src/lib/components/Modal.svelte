<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { dialogTransitions, watchReducedMotion } from '$lib/overlay-motion';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		visible: boolean;
		title: string;
		/** Submit handler; the primary button row is hidden when omitted. */
		onsubmit?: () => void;
		/** Called whenever the dialog should close (Escape, backdrop, X, cancel). */
		onclose: () => void;
		submitText?: string;
		submitDisabled?: boolean;
		width?: string;
		children: Snippet;
	}

	let {
		visible,
		title,
		onsubmit,
		onclose,
		submitText = '确定',
		submitDisabled = false,
		width = '27rem',
		children
	}: Props = $props();

	let panel = $state<HTMLDivElement | null>(null);

	// reduced-motion 只能在 JS 里判断：svelte/transition 写的是 JS 驱动的内联样式，
	// app.css 里的 @media (prefers-reduced-motion: reduce) 对它无效。
	let reduced = $state(false);
	$effect(() => watchReducedMotion((value) => (reduced = value)));

	let motion = $derived(dialogTransitions(reduced));

	// 退场动画播完之前面板还在 DOM 里（outro 结束才移除），这 160ms 里
	// 面板上的按钮照样能点，「确定」会被点第二次、提交两次。
	// 这里不用自己处理：Svelte 5 的过渡在 outro 开始时会给带 transition 的元素
	// 自动打上 inert（进场时还原），遮罩和面板都带 transition，
	// 所以整块遮罩在这段时间里都点不动。
	$effect(() => {
		if (!visible) return;
		function onKeydown(event: KeyboardEvent) {
			if (event.key === 'Escape') onclose();
		}
		window.addEventListener('keydown', onKeydown);
		panel?.focus();
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

{#if visible}
	<div
		transition:fade={motion.backdrop}
		class="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[2px]"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) onclose();
		}}
	>
		<div
			bind:this={panel}
			transition:fly={motion.panel}
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			class="max-h-[85vh] w-full overflow-y-auto rounded-[var(--radius-box)] border border-border bg-bg-surface shadow-popover outline-none"
			style="max-width:{width}"
		>
			<div class="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
				<h3 class="text-[14px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
				<button
					type="button"
					aria-label="关闭"
					onclick={onclose}
					class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-bg-hover hover:text-fg"
				>
					<Icon name="close" size={15} />
				</button>
			</div>

			<div class="space-y-4 px-5 py-5">
				{@render children()}
			</div>

			{#if onsubmit}
				<div class="flex justify-end gap-2 border-t border-border bg-bg-overlay/60 px-5 py-3.5">
					<Button variant="secondary" onclick={onclose}>取消</Button>
					<Button variant="primary" disabled={submitDisabled} onclick={() => onsubmit?.()}>
						{submitText}
					</Button>
				</div>
			{/if}
		</div>
	</div>
{/if}
