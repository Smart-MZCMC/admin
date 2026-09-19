<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import Spinner from './Spinner.svelte';
	import type { Column } from './table';

	interface Props {
		columns: Column[];
		rows: T[];
		/** Stable key for keyed each blocks. */
		rowKey: (row: T) => string | number;
		loading?: boolean;
		emptyText?: string;
		/** Footer content, e.g. a result count. */
		footer?: Snippet;
		/** Per-cell renderer; falls back to `row[column.key]`. */
		cell?: Snippet<[T, Column]>;
	}

	let {
		columns,
		rows,
		rowKey,
		loading = false,
		emptyText = '暂无数据',
		footer,
		cell
	}: Props = $props();

	function raw(row: T, key: string): unknown {
		return (row as Record<string, unknown>)[key];
	}
</script>

<div class="overflow-x-auto">
	<table class="w-full border-collapse text-[13px]">
		<thead>
			<tr>
				{#each columns as column (column.key)}
					<th
						class="border-b border-white/10 px-4 py-3 text-[11px] font-medium tracking-wider text-gray-500 uppercase {column.align ===
						'right'
							? 'text-right'
							: 'text-left'}"
						style={column.width ? `width:${column.width}` : undefined}
					>
						{column.label}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if loading}
				<tr>
					<td colspan={columns.length}>
						<Spinner />
					</td>
				</tr>
			{:else if rows.length === 0}
				<tr>
					<td colspan={columns.length} class="px-4 py-10 text-center text-[13px] text-gray-500">
						{emptyText}
					</td>
				</tr>
			{:else}
				{#each rows as row (rowKey(row))}
					<tr class="transition-colors hover:bg-primary/5">
						{#each columns as column (column.key)}
							<td
								class="border-b border-white/5 px-4 py-3 align-middle text-gray-400 {column.align ===
								'right'
									? 'text-right'
									: 'text-left'}"
							>
								{#if cell}
									{@render cell(row, column)}
								{:else}
									{raw(row, column.key) ?? '-'}
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			{/if}
		</tbody>
		{#if footer && !loading}
			<tfoot>
				<tr>
					<td colspan={columns.length} class="px-4 py-3 text-[12px] text-gray-500">
						{@render footer()}
					</td>
				</tr>
			</tfoot>
		{/if}
	</table>
</div>
