<script lang="ts">
	interface Props {
		label: string;
		/** 0-100。超过 100 会被夹住——磁盘 101% 那类数据不该把条撑破布局。 */
		percent: number;
		/** 右侧附加说明，例如「26.08 GB / 39.01 GB」。 */
		note?: string;
		tone?: 'primary' | 'success' | 'warning' | 'error';
	}

	let { label, percent, note, tone = 'primary' }: Props = $props();

	const fill: Record<NonNullable<Props['tone']>, string> = {
		primary: 'bg-primary',
		success: 'bg-success',
		warning: 'bg-warning',
		error: 'bg-error'
	};

	// NaN 会让 style="width: NaN%" 整条消失，而它来自后端的除零保护之外的情况
	// （比如接口返回了 null）。夹一下比在页面上写一堆三元运算省事。
	const clamped = $derived(Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0);
	const rounded = $derived(Math.round(clamped * 10) / 10);
</script>

<div>
	<div class="mb-1.5 flex items-baseline justify-between gap-3">
		<span class="text-[12px] font-medium text-fg-muted">{label}</span>
		{#if note}
			<span class="truncate text-[11.5px] text-fg-faint tabular-nums">{note}</span>
		{/if}
	</div>
	<div
		class="h-2 w-full overflow-hidden rounded-full bg-bg-surface"
		role="progressbar"
		aria-valuenow={rounded}
		aria-valuemin="0"
		aria-valuemax="100"
		aria-label={label}
	>
		<div
			class="h-full rounded-full transition-[width] duration-300 ease-out {fill[tone]}"
			style="width: {rounded}%"
		></div>
	</div>
</div>
