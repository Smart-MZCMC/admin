<script lang="ts">
	interface Props {
		label: string;
		value: string;
		type?: 'text' | 'password' | 'number';
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		/** Toggle browser autofill for the field. */
		autocomplete?: boolean;
		/** Fired when Enter is pressed while the field has focus. */
		onenter?: () => void;
	}

	let {
		label,
		value = $bindable(),
		type = 'text',
		placeholder = '',
		required = false,
		disabled = false,
		autocomplete = false,
		onenter
	}: Props = $props();
</script>

<label class="block">
	<span class="mb-1.5 flex items-center gap-1 text-[12px] font-medium text-fg">
		{label}
		{#if required}<span class="text-error">*</span>{/if}
	</span>
	<input
		{type}
		{placeholder}
		{disabled}
		{required}
		bind:value
		autocomplete={autocomplete ? 'on' : 'off'}
		onkeydown={(event) => {
			if (event.key === 'Enter') onenter?.();
		}}
		class="h-10 w-full rounded-[var(--radius-form)] border border-border bg-bg-surface px-3 text-[13px] text-fg transition-colors placeholder:text-fg-faint hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none disabled:bg-bg-overlay disabled:text-fg-faint"
	/>
</label>
