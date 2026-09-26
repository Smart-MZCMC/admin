<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	type Tone = 'primary' | 'success' | 'warning' | 'info' | 'slate';

	interface Props {
		label: string;
		value: string | number | null;
		/** Small secondary line under the value. */
		hint?: string;
		icon?: IconName;
		tone?: Tone;
	}

	let { label, value, hint, icon, tone = 'primary' }: Props = $props();

	const badge: Record<Tone, string> = {
		primary: 'bg-primary-soft text-primary-ink',
		success: 'bg-success-soft text-success-ink',
		warning: 'bg-warning-soft text-warning-ink',
		info: 'bg-info-soft text-info-ink',
		slate: 'bg-neutral-soft text-neutral-ink'
	};

	const display = $derived(value === null ? '—' : value);
</script>

<div class="rounded-[var(--radius-box)] border border-border bg-bg-surface px-4 py-4 shadow-panel">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<div class="text-[12px] font-medium text-fg-muted">{label}</div>
			<div
				class="mt-2 text-[24px] leading-none font-semibold tracking-[-0.02em] text-fg tabular-nums"
			>
				{display}
			</div>
			{#if hint}
				<div class="mt-2 truncate text-[11px] text-fg-faint">{hint}</div>
			{/if}
		</div>
		{#if icon}
			<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {badge[tone]}">
				<Icon name={icon} size={16} />
			</span>
		{/if}
	</div>
</div>
