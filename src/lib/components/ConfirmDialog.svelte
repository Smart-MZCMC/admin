<script lang="ts">
	import type { Snippet } from 'svelte';

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

	function cancel() {
		onclose();
	}

	$effect(() => {
		if (!visible) return;
		function onKeydown(event: KeyboardEvent) {
			if (event.key === 'Escape') cancel();
		}
		window.addEventListener('keydown', onKeydown);
		panel?.focus();
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

{#if visible}
	<div
		class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) cancel();
		}}
	>
		<div
			bind:this={panel}
			role="alertdialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			class="w-full max-w-md rounded-[var(--radius-box)] border border-white/10 bg-bg-surface p-6 shadow-2xl outline-none"
		>
			<h3 class="mb-3 text-base font-semibold text-primary">{title}</h3>
			<p class="text-sm leading-relaxed text-gray-400">{message}</p>

			{#if children}
				<div class="mt-4">
					{@render children()}
				</div>
			{/if}

			<div class="mt-6 flex justify-end gap-2">
				<button
					type="button"
					onclick={cancel}
					class="cursor-pointer rounded-[var(--radius-small)] border border-white/10 px-4 py-2 text-[13px] text-gray-400 transition-colors hover:border-primary hover:text-primary"
				>
					取消
				</button>
				<button
					type="button"
					onclick={() => onconfirm()}
					class="cursor-pointer rounded-[var(--radius-small)] px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-90 {danger
						? 'bg-error text-white'
						: 'bg-primary text-text-on-primary'}"
				>
					{confirmText}
				</button>
			</div>
		</div>
	</div>
{/if}
