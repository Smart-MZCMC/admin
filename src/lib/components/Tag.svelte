<script lang="ts">
	/**
	 * Small status pill.
	 *
	 * STDF 1.2.0 (the version this project installs) has no `Tag` component —
	 * the bundled skill docs describe a newer snapshot. This is a local
	 * replacement built from the same STDF theme tokens, so colours stay
	 * consistent with the vendored components.
	 */
	type State = 'theme' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

	interface Props {
		text: string;
		state?: State;
		size?: 'xs' | 'sm';
	}

	let { text, state = 'theme', size = 'sm' }: Props = $props();

	const stateClass: Record<State, string> = {
		theme: 'bg-primary/12 text-primary border-primary/25',
		success: 'bg-success/12 text-success border-success/25',
		warning: 'bg-warning/12 text-warning border-warning/25',
		error: 'bg-error/12 text-error border-error/25',
		info: 'bg-info/12 text-info border-info/25',
		neutral: 'bg-white/6 text-gray-400 border-white/12'
	};
</script>

<span
	class="inline-flex items-center rounded-full border px-2 py-0.5 whitespace-nowrap {stateClass[
		state
	]} {size === 'xs' ? 'text-[10px]' : 'text-[11px]'}"
>
	{text}
</span>
