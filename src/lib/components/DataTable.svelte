<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
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
	<table class="w-full border-collapse text-[12.5px]">
		<thead>
			<tr class="bg-bg-overlay/80">
				{#each columns as column (column.key)}
					<th
						class="border-b border-border px-5 py-2.5 text-[10.5px] font-semibold tracking-[0.06em] whitespace-nowrap text-fg-muted uppercase {column.align ===
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
					<td colspan={columns.length} class="px-5 py-14 text-center">
						<span
							class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary align-middle"
						></span>
					</td>
				</tr>
			{:else if rows.length === 0}
				<tr>
					<td colspan={columns.length} class="px-5 py-14 text-center">
						<span class="text-[12.5px] text-fg-faint">{emptyText}</span>
					</td>
				</tr>
			{:else}
				{#each rows as row (rowKey(row))}
					<tr class="border-b border-border transition-colors last:border-0 hover:bg-bg-overlay/70">
						{#each columns as column (column.key)}
							<td
								class="px-5 py-3 align-middle text-fg-muted {column.align === 'right'
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
				<tr class="bg-bg-overlay/60">
					<td colspan={columns.length} class="px-5 py-2.5 text-[11.5px] text-fg-muted">
						{@render footer()}
					</td>
				</tr>
			</tfoot>
		{/if}
	</table>
</div>
