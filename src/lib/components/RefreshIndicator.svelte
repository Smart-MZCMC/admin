<script lang="ts">
	import { countdownText, pollProgress, timeAgo } from '$lib/live-metrics';
	import Icon from './Icon.svelte';

	interface Props {
		/** 是否处于自动刷新状态。开关按钮直接调 onToggle，不需要两向绑定。 */
		enabled: boolean;
		/**
		 * 下一次请求的预定时刻（毫秒时间戳）。
		 *
		 * 倒计时、进度条与真正的轮询都读这一个数。三者各算各的就会出现
		 * 「倒计时归零了但数据没来」，而这种错位在页面上完全看不出来。
		 */
		dueAt: number;
		/** 轮询间隔，进度条按它归一化。 */
		intervalMs: number;
		/** 最近一次成功读到数据的时刻。与 dueAt 分开，是为了断线时不谎报新鲜度。 */
		lastOkAt: number;
		onToggle: () => void;
	}

	let { enabled, dueAt, intervalMs, lastOkAt, onToggle }: Props = $props();

	/**
	 * 秒针放在组件内部，而不是页面里。
	 *
	 * 它每 200ms 变一次；放在页面里等于拖着整页 main 一起重排，而真正需要动的
	 * 只有这几行字。放在这里，依赖变化只波及这个组件。
	 */
	let now = $state(Date.now());

	$effect(() => {
		// 暂停时也不能停：倒计时与进度条确实没有下一次可等，但「上次刷新 N 秒前」
		// 必须继续走。停掉它的话，暂停一分钟后仍显示「数据停在 1 秒前」——
		// 那是在谎报数据有多新，比没有这个提示更糟。
		const id = setInterval(() => {
			now = Date.now();
		}, 200);
		return () => clearInterval(id);
	});

	const countdown = $derived(countdownText(now, dueAt));
	const progress = $derived(pollProgress(now, dueAt, intervalMs));
	const scale = $derived(progress.toFixed(3));
	const percent = $derived(Math.round(progress * 100));
	// 暂停时进度不该继续长：那个 3px 的条只回答「还有多久刷新」，
	// 没有下一次刷新时它就没有意义，硬留着只会让人以为还在自动刷。
	const scaleX = $derived(enabled ? scale : '0');
	const ago = $derived(timeAgo(now, lastOkAt));

	/**
	 * 说明写在 title 里，不常驻在屏幕上。
	 *
	 * 页头这块地方本来就挤，而「多久一次、读的是什么」属于需要时才查的信息。
	 */
	const hint = $derived(
		enabled
			? `每 ${Math.round(intervalMs / 1000)} 秒自动读取一次运行指标。上次成功读取：${ago}。`
			: `自动刷新已暂停，数据停在 ${ago}。可按「继续」恢复，或按「立即刷新」手动读取。`
	);
</script>

<!--
	状态不靠颜色区分：开启时是「呼吸点 + 进度条 + 秒数」，暂停时三样全都没有，
	只剩一个虚线空心圈和「已暂停」三个字。色觉障碍用户与黑白截图都能分辨。
-->
<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-fg-muted" title={hint}>
	<span class="inline-flex items-center gap-1.5">
		<span class="relative inline-flex h-1.5 w-1.5 shrink-0 items-center justify-center">
			{#if enabled}
				<span class="live-breathe absolute h-1.5 w-1.5 rounded-full bg-info"></span>
				<span class="relative h-1.5 w-1.5 rounded-full bg-info"></span>
			{:else}
				<span class="h-1.5 w-1.5 rounded-full border border-dashed border-fg-faint"></span>
			{/if}
		</span>
		<span class="font-medium text-fg">{enabled ? '自动刷新' : '已暂停'}</span>
	</span>

	{#if enabled}
		<!--
			进度条是倒计时的图形版本：长度就是「还剩多久」。
			动 transform 而不是 width——前者走合成层，每 200ms 一跳也不会压到主线程。
			role/aria 一起给：屏幕阅读器读得到进度，而它每秒都变，
			所以绝不能挂 aria-live，否则读屏会被一句话刷屏。
		-->
		<span
			class="relative block h-[3px] w-14 overflow-hidden rounded-full bg-border"
			role="progressbar"
			aria-label="距下一次自动刷新"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={percent}
		>
			<span
				class="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-info/70 transition-transform duration-150 ease-linear"
				style="transform: scaleX({scaleX})"
			></span>
		</span>
		<span class="tabular-nums {countdown.overdue ? 'text-info-ink' : 'text-fg-faint'}">
			{countdown.text}
		</span>
	{/if}

	<span class="text-fg-faint tabular-nums">
		{#if enabled}上次刷新 {ago}{:else}数据停在 {ago}{/if}
	</span>

	<button
		type="button"
		class="inline-flex cursor-pointer items-center gap-1 rounded-[var(--radius-small)] border border-border px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
		onclick={onToggle}
		aria-pressed={!enabled}
		title={enabled ? '暂停自动刷新，便于查看当前数值' : '恢复自动刷新'}
	>
		<Icon name={enabled ? 'close' : 'refresh'} size={10} />
		{enabled ? '暂停' : '继续'}
	</button>
</div>
