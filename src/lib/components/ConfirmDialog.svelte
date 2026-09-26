<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	/** Confirmation dialog replacing window.confirm(). */
	interface Props {
		visible: boolean;
		title?: string;
		message: string;
		confirmText?: string;
		/** Render the confirm button in the danger/error colour. */
		danger?: boolean;
		onconfirm: () => void;
		/** Called whenever the dialog is dismissed without confirming. */
		onclose: () => void;
		/** Optional extra controls rendered under the message. */
		children?: Snippet;
	}

	let {
		visible,
		title = '请确认',
		message,
		confirmText = '确定',
		danger = false,
		onconfirm,
		onclose,
		children
	}: Props = $props();

	let panel = $state<HTMLDivElement | null>(null);

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
		class="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[2px]"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) onclose();
		}}
	>
		<div
			bind:this={panel}
			role="alertdialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			class="w-full max-w-md rounded-[var(--radius-box)] border border-border bg-bg-surface p-5 shadow-popover outline-none"
		>
			<div class="flex gap-3">
				<span
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full {danger
						? 'bg-error-soft text-error-ink'
						: 'bg-primary-soft text-primary-ink'}"
				>
					<Icon name={danger ? 'alert' : 'check'} size={17} />
				</span>
				<div class="min-w-0 pt-0.5">
					<h3 class="text-[14px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
					<p class="mt-1.5 text-[12.5px] leading-relaxed text-fg-muted">{message}</p>
				</div>
			</div>

			{#if children}
				<div class="mt-4">
					{@render children()}
				</div>
			{/if}

			<div class="mt-5 flex justify-end gap-2">
				<Button variant="secondary" onclick={onclose}>取消</Button>
				<Button variant={danger ? 'danger' : 'primary'} onclick={() => onconfirm()}>
					{confirmText}
				</Button>
			</div>
		</div>
	</div>
{/if}
