<script lang="ts">
	import { valueChange, type ChangeDirection } from '$lib/live-metrics';

	interface Props {
		/** 页面上显示的文本。是否变化只看它——判断的是「用户看到的有没有变」。 */
		value: string;
		/** 可选的数值，仅用于判断箭头朝上还是朝下。 */
		rank?: number;
		/** 悬停提示。缺省时用 value 本身。 */
		title?: string;
		class?: string;
	}

	let { value, rank, title, class: klass = '' }: Props = $props();

	/** 箭头停留时长。比高亮长：底色淡得快，箭头要在视线扫过时还在。 */
	const ARROW_MS = 2200;

	let flash = $state<{ token: number; direction: ChangeDirection } | null>(null);
	let token = 0;

	/**
	 * 上一次看到的读数。
	 *
	 * 故意不放在 $state 里：它不参与渲染，反应式只会带来一次多余的更新。
	 * 用普通变量也顺带保证了下面的 $effect 不会因为写它而自激。
	 */
	let previous: { text: string; rank?: number } | undefined;

	$effect(() => {
		// 先把 value/rank 读出来建立依赖，再做比较。
		const next = { text: value, rank };
		const result = valueChange(previous, next);
		previous = next;
		// 没变时什么都不做——不播动画是这里最重要的一条。
		if (result.changed) {
			flash = { token: ++token, direction: result.direction };
		}
	});

	$effect(() => {
		const current = flash;
		if (!current) return;
		const id = setTimeout(() => {
			// 只清自己那一次：连续两次变化时，旧定时器不能把新提示抹掉。
			if (flash?.token === current.token) flash = null;
		}, ARROW_MS);
		return () => clearTimeout(id);
	});

	const arrow = $derived(flash?.direction === 'up' ? '▲' : flash?.direction === 'down' ? '▼' : '');
</script>

<span class="inline-flex items-baseline gap-1 {klass}" title={title ?? value}>
	<!--
		keyed 而不是靠 class 反复增删：同一个 class 第二次加上时浏览器不会重播动画，
		重建元素才保证「每一次真变化都看得见」。重建范围只有这个数字，
		不会牵动外层布局。
	-->
	{#key flash?.token ?? 0}
		<span class="tabular-nums {flash ? 'value-flash' : ''}">{value}</span>
	{/key}
	{#if arrow}
		<!-- 箭头不参与动画：系统关掉动效时它是唯一的提示，必须留着。 -->
		<span class="text-[9px] leading-none text-info-ink" aria-hidden="true">{arrow}</span>
	{/if}
</span>
