<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
	type Size = 'sm' | 'md';

	interface Props {
		variant?: Variant;
		size?: Size;
		type?: 'button' | 'submit';
		disabled?: boolean;
		loading?: boolean;
		icon?: IconName;
		/** Renders a square icon-only button; `label` then becomes the a11y name. */
		iconOnly?: boolean;
		label?: string;
		title?: string;
		full?: boolean;
		onclick?: (event: MouseEvent) => void;
		children?: Snippet;
	}

	let {
		variant = 'secondary',
		size = 'md',
		type = 'button',
		disabled = false,
		loading = false,
		icon,
		iconOnly = false,
		label,
		title,
		full = false,
		onclick,
		children
	}: Props = $props();

	const variants: Record<Variant, string> = {
		primary:
			'bg-primary text-white border border-primary hover:bg-primary-700 hover:border-primary-700',
		secondary:
			'bg-bg-surface text-fg border border-border hover:bg-bg-overlay hover:border-border-strong',
		ghost: 'bg-transparent text-fg-muted border border-transparent hover:bg-bg-hover hover:text-fg',
		danger: 'bg-error text-white border border-error hover:brightness-110',
		'danger-ghost':
			'bg-bg-surface text-error-ink border border-error-line hover:bg-error-soft hover:border-error-ink/40'
	};

	const sizes: Record<Size, string> = {
		sm: 'h-8 text-[12px] gap-1.5',
		md: 'h-9 text-[12.5px] gap-2'
	};

	const pad = $derived(
		iconOnly ? (size === 'sm' ? 'w-8 px-0' : 'w-9 px-0') : size === 'sm' ? 'px-3' : 'px-3.5'
	);
</script>

<button
	{type}
	{title}
	disabled={disabled || loading}
	aria-label={iconOnly ? (label ?? title) : undefined}
	{onclick}
	class="inline-flex cursor-pointer items-center justify-center rounded-[var(--radius-form)] font-medium whitespace-nowrap shadow-control transition-colors disabled:cursor-not-allowed disabled:opacity-50 {variants[
		variant
	]} {sizes[size]} {pad} {full ? 'w-full' : ''}"
>
	{#if loading}
		<span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current"
		></span>
	{:else if icon}
		<Icon name={icon} size={size === 'sm' ? 15 : 16} />
	{/if}
	{#if !iconOnly && children}
		{@render children()}
	{/if}
</button>
