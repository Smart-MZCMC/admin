<script lang="ts">
	import { Input } from 'stdf';

	interface Props {
		label: string;
		value: string;
		type?: 'text' | 'password' | 'number';
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
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
		autocomplete = true,
		onenter
	}: Props = $props();

	function handleChange(next: string) {
		value = next;
	}

	function handleEnter(key: string) {
		if (key === 'Enter') onenter?.();
	}
</script>

<Input
	title={label}
	{value}
	{type}
	{placeholder}
	{required}
	{disabled}
	{autocomplete}
	py="2"
	onchange={handleChange}
	onkeydown={handleEnter}
/>
