import { browser } from '$app/environment';
import { cubicOut } from 'svelte/easing';
import type { FadeParams, FlyParams } from 'svelte/transition';

/**
 * 弹窗与浮层的动效参数集中在这里，Modal / ConfirmDialog / ToastHost 共用同一份。
 * 参数散在三个组件里迟早会漂移——确认框比表单弹窗早半拍进入这种事，用户说不出
 * 哪里怪，但会觉得「这个系统毛躁」。
 *
 * 站内约定：
 * - 时长 120–200ms，弹窗 160ms、提示条 120ms；
 * - 缓动用同一条 cubicOut。进场是正向（ease-out），Svelte 把同一条曲线倒着插值
 *   就是退场（ease-in），所以进出一对参数不用分别写；
 * - 位移不超过 12px，不做回弹/缩放。弹窗是「响应」不是「表演」。
 */

/** 系统「减弱动态效果」开关。Svelte 过渡是 JS 写的内联样式，app.css 里的媒体查询拦不住。 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 超过这个时长，弹窗就读成「卡顿」而不是「弹出」。 */
export const MAX_DURATION = 200;

export const DIALOG_DURATION = 160;
/** 面板进场位移（px）。 */
export const DIALOG_RISE = 10;

export const TOAST_DURATION = 120;
/** 提示条从右上方滑入的位移（px）。 */
export const TOAST_SLIDE_X = 20;
export const TOAST_SLIDE_Y = -4;

/**
 * 把「想要的时长」翻译成「实际播多久」。
 *
 * 命中减少动态效果时返回 0，而不是「短一点的动画」——Svelte 见到 duration 0
 * 会直接跳过整个过渡流程（连关键帧都不生成），元素立刻出现/消失，这正是
 * 想要的效果；给个 5ms 反而会留下一帧半透明的中间态。
 */
export function resolveDuration(reduced: boolean, duration: number): number {
	if (reduced) return 0;
	// 参数非法时退回「不动画」。一个 NaN 时长会让过渡永远不结束，弹窗就再也关不掉了。
	if (!Number.isFinite(duration) || duration <= 0) return 0;
	return Math.min(duration, MAX_DURATION);
}

export interface DialogTransitions {
	/** 全屏遮罩。 */
	backdrop: FadeParams;
	/** 面板本体。 */
	panel: FlyParams;
}

/** 弹窗与确认框共用同一份参数——两者结构一样，手感也必须一样。 */
export function dialogTransitions(reduced: boolean): DialogTransitions {
	const duration = resolveDuration(reduced, DIALOG_DURATION);
	return {
		backdrop: { duration, easing: cubicOut },
		panel: { duration, easing: cubicOut, y: DIALOG_RISE }
	};
}

/**
 * 提示条比弹窗更轻更快：它只是路过的信息，不该抢注意力。
 * fly 一次带上位移和淡入，不要再叠 scale——两条过渡都写 transform，会互相覆盖。
 */
export function toastTransition(reduced: boolean): FlyParams {
	return {
		duration: resolveDuration(reduced, TOAST_DURATION),
		easing: cubicOut,
		x: TOAST_SLIDE_X,
		y: TOAST_SLIDE_Y
	};
}

/**
 * 订阅系统「减弱动态效果」开关，返回取消订阅的函数。
 *
 * 要监听 change 而不是只在挂载时读一次：用户是在会话中间改系统设置的，
 * 改完立刻再开一个弹窗就该是不动的。
 */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
	if (!browser || typeof window.matchMedia !== 'function') {
		onChange(false);
		return () => {};
	}
	const query = window.matchMedia(REDUCED_MOTION_QUERY);
	const onChangeEvent = (event: MediaQueryListEvent) => onChange(event.matches);
	query.addEventListener('change', onChangeEvent);
	onChange(query.matches);
	return () => query.removeEventListener('change', onChangeEvent);
}
