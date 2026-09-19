<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		visible: boolean;
		title: string;
		/** Submit handler; the primary button is hidden when omitted. */
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
		width = '26rem',
		children
	}: Props = $props();

	let panel = $state<HTMLDivElement | null>(null);

	function close() {
		onclose();
	}

	// Escape closes, and focus moves into the dialog when it opens.
	$effect(() => {
		if (!visible) return;
		function onKeydown(event: KeyboardEvent) {
			if (event.key === 'Escape') close();
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
			if (event.target === event.currentTarget) close();
		}}
	>
		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			class="max-h-[85vh] w-full overflow-y-auto rounded-[var(--radius-box)] border border-white/10 bg-bg-surface p-6 shadow-2xl outline-none"
			style="max-width:{width}"
		>
			<div class="mb-5 flex items-center justify-between gap-4">
				<h3 class="text-base font-semibold text-primary">{title}</h3>
				<button
					type="button"
					aria-label="关闭"
					onclick={close}
					class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[var(--radius-small)] text-xl leading-none text-gray-500 transition-colors hover:bg-white/5 hover:text-text-dark"
				>
					&times;
				</button>
			</div>

			<div class="space-y-4">
				{@render children()}
			</div>

			{#if onsubmit}
				<div class="mt-6 flex justify-end gap-2">
					<button
						type="button"
						onclick={close}
						class="cursor-pointer rounded-[var(--radius-small)] border border-white/10 px-4 py-2 text-[13px] text-gray-400 transition-colors hover:border-primary hover:text-primary"
					>
						取消
					</button>
					<button
						type="button"
						disabled={submitDisabled}
						onclick={() => onsubmit?.()}
						class="cursor-pointer rounded-[var(--radius-small)] bg-primary px-4 py-2 text-[13px] font-medium text-text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{submitText}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
