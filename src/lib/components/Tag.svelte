<script lang="ts">
	type State = 'theme' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

	interface Props {
		text: string;
		state?: State;
		size?: 'xs' | 'sm';
	}

	let { text, state = 'theme', size = 'sm' }: Props = $props();

	const pill: Record<State, string> = {
		theme: 'bg-primary-soft text-primary-ink border-primary-ink/20',
		success: 'bg-success-soft text-success-ink border-success-ink/20',
		warning: 'bg-warning-soft text-warning-ink border-warning-ink/20',
		error: 'bg-error-soft text-error-ink border-error-ink/20',
		info: 'bg-info-soft text-info-ink border-info-ink/20',
		neutral: 'bg-neutral-soft text-neutral-ink border-border'
	};

	const dot: Record<State, string> = {
		theme: 'bg-primary-ink',
		success: 'bg-success',
		warning: 'bg-warning',
		error: 'bg-error',
		info: 'bg-info',
		neutral: 'bg-fg-faint'
	};
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full border px-2 py-[2px] font-medium whitespace-nowrap {pill[
		state
	]} {size === 'xs' ? 'text-[10px]' : 'text-[11px]'}"
>
	<span class="h-1.5 w-1.5 shrink-0 rounded-full {dot[state]}"></span>
	{text}
</span>
