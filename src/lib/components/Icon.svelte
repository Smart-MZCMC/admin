<script lang="ts">
	import type { IconName } from './icons';

	interface Props {
		name: IconName;
		size?: number;
		strokeWidth?: number;
		class?: string;
	}

	let { name, size = 18, strokeWidth = 1.7, ...rest }: Props = $props();
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	{...rest}
>
	{#if name === 'overview'}
		<rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
		<rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
		<rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
		<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
	{:else if name === 'users'}
		<path d="M16 19.5V18a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18v1.5" />
		<circle cx="10" cy="8" r="3.5" />
		<path d="M20 19.5V18a3.5 3.5 0 0 0-2.6-3.4" />
		<path d="M15.4 4.6a3.5 3.5 0 0 1 0 6.8" />
	{:else if name === 'projects'}
		<path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" />
		<path d="m3.5 12 8.5 4.5L20.5 12" />
		<path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
	{:else if name === 'assign'}
		<circle cx="8" cy="13.5" r="4.5" />
		<path d="m11.2 10.3 8.3-8.3" />
		<path d="m16.8 4.5 2.7 2.7" />
		<path d="m14.3 7 2.7 2.7" />
	{:else if name === 'logs'}
		<path
			d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8l-5-5Z"
		/>
		<path d="M14 3v5h5" />
		<path d="M9 13h6" />
		<path d="M9 17h4" />
	{:else if name === 'plugins'}
		<path d="M2.5 20.5h19" />
		<path d="M6 20.5V11" />
		<path d="M12 20.5V4" />
		<path d="M18 20.5v-6" />
	{:else if name === 'search'}
		<circle cx="11" cy="11" r="6.5" />
		<path d="m16.2 16.2 4.3 4.3" />
	{:else if name === 'bell'}
		<path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5" />
		<path d="M13.7 19a2 2 0 0 1-3.4 0" />
	{:else if name === 'chevron-down'}
		<path d="m6 9.5 6 6 6-6" />
	{:else if name === 'menu'}
		<path d="M3.5 7h17" />
		<path d="M3.5 12h17" />
		<path d="M3.5 17h17" />
	{:else if name === 'close'}
		<path d="m6 6 12 12" />
		<path d="m18 6-12 12" />
	{:else if name === 'logout'}
		<path d="M9.5 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h3" />
		<path d="m15 8 4 4-4 4" />
		<path d="M19 12H9.5" />
	{:else if name === 'plus'}
		<path d="M12 5v14" />
		<path d="M5 12h14" />
	{:else if name === 'check'}
		<path d="m5 12.5 4.6 4.6L19 7.5" />
	{:else if name === 'copy'}
		<rect x="9" y="9" width="11.5" height="11.5" rx="2.2" />
		<path d="M5.5 15h-1A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5v1" />
	{:else if name === 'edit'}
		<path d="M12 20.5h8.5" />
		<path d="M16.6 3.9a2.2 2.2 0 0 1 3.1 3.1L7.5 19.2 3 20.5l1.3-4.5L16.6 3.9Z" />
	{:else if name === 'trash'}
		<path d="M4 7h16" />
		<path d="M10 11v6" />
		<path d="M14 11v6" />
		<path d="m6 7 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
		<path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
	{:else if name === 'refresh'}
		<path d="M20 11.5A8 8 0 0 0 6.3 6.4L3 9.5" />
		<path d="M3 4.5v5h5" />
		<path d="M4 12.5a8 8 0 0 0 13.7 5.1L21 14.5" />
		<path d="M21 19.5v-5h-5" />
	{:else if name === 'alert'}
		<path d="M12 3.5 21.5 19.5h-19L12 3.5Z" />
		<path d="M12 9.5V14" />
		<path d="M12 17.2h.01" />
	{:else if name === 'download'}
		<path d="M12 3.5v11" />
		<path d="m7.5 10 4.5 4.5L16.5 10" />
		<path d="M4 19.5h16" />
	{:else if name === 'filter'}
		<path d="M3.5 5h17l-6.5 7.5V19l-4-2v-4.5L3.5 5Z" />
	{:else if name === 'activity'}
		<path d="M3 12h3.5l2.5-6.5 4.5 13 2.5-6.5H21" />
	{/if}
</svg>
