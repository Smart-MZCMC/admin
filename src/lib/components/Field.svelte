<script lang="ts">
	interface Props {
		label: string;
		value: string;
		/**
		 * 'email' 是为用户中心的邮箱输入加的。用浏览器原生的 email 类型能拿到
		 * 移动端邮箱键盘与基础格式校验，不用自己维护一套正则。
		 */
		type?: 'text' | 'password' | 'number' | 'email';
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		/** Toggle browser autofill for the field. */
		autocomplete?: boolean;
		/** Fired when Enter is pressed while the field has focus. */
		onenter?: () => void;
		/** Inline hint below the field. */
		hint?: string;
	}

	let {
		label,
		value = $bindable(),
		type = 'text',
		placeholder = '',
		required = false,
		disabled = false,
		autocomplete = false,
		onenter,
		hint = ''
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
	{#if hint}
		<span class="mt-1.5 block text-[11.5px] text-fg-faint">{hint}</span>
	{/if}
</label>
