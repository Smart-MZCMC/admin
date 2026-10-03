import { cubicOut } from 'svelte/easing';
import { describe, expect, it, vi } from 'vitest';
import {
	DIALOG_DURATION,
	DIALOG_RISE,
	MAX_DURATION,
	REDUCED_MOTION_QUERY,
	TOAST_DURATION,
	dialogTransitions,
	resolveDuration,
	toastTransition,
	watchReducedMotion
} from './overlay-motion';

/**
 * 弹窗动效的判断都在 overlay-motion 里，这里钉住三件事：
 *
 * 1. reduced-motion 必须真的落到 0ms——退化成「很短的动画」仍会留下半透明中间态；
 * 2. 时长参数非法时退回「不动画」——NaN 会让过渡永远不结束，弹窗就再也关不掉；
 * 3. Modal 与 ConfirmDialog 共用同一份参数——两者结构一样，手感不该各调各的。
 */

/** x/y 也允许写成 '1rem' 这种带单位的值，断言幅度时统一折成数字。 */
function px(value: number | string | undefined): number {
	if (typeof value === 'number') return value;
	return Number.parseFloat(value ?? '') || 0;
}

describe('resolveDuration', () => {
	it('没开减少动态效果时按给的时长播', () => {
		expect(resolveDuration(false, 160)).toBe(160);
		expect(resolveDuration(false, 120)).toBe(120);
	});

	it('开了减少动态效果就是 0ms', () => {
		expect(resolveDuration(true, 160)).toBe(0);
		expect(resolveDuration(true, 120)).toBe(0);
	});

	it('时长非法时退回不动画，而不是把 NaN 传下去', () => {
		expect(resolveDuration(false, Number.NaN)).toBe(0);
		expect(resolveDuration(false, Number.POSITIVE_INFINITY)).toBe(0);
		expect(resolveDuration(false, -160)).toBe(0);
		expect(resolveDuration(false, 0)).toBe(0);
	});

	it('超过上限的时长压回上限——弹窗超过 200ms 读起来是卡顿', () => {
		expect(resolveDuration(false, 900)).toBe(MAX_DURATION);
	});

	it('非法时长遇上 reduced 也还是 0', () => {
		expect(resolveDuration(true, Number.NaN)).toBe(0);
	});
});

describe('dialogTransitions', () => {
	it('遮罩和面板同时长，手感一致', () => {
		const motion = dialogTransitions(false);
		expect(motion.backdrop.duration).toBe(DIALOG_DURATION);
		expect(motion.panel.duration).toBe(DIALOG_DURATION);
	});

	it('进出共用 cubicOut：进场是 ease-out，曲线倒着插值就是退场的 ease-in', () => {
		const motion = dialogTransitions(false);
		expect(motion.panel.easing).toBe(cubicOut);
		expect(motion.backdrop.easing).toBe(cubicOut);
		// ease-out 的形状：前段比匀速快，后段慢下来。
		expect(cubicOut(0.25)).toBeGreaterThan(0.25);
		expect(cubicOut(1)).toBeCloseTo(1, 5);
	});

	it('面板只做小幅上移，不做回弹', () => {
		const motion = dialogTransitions(false);
		expect(px(motion.panel.y)).toBe(DIALOG_RISE);
		expect(Math.abs(px(motion.panel.y))).toBeLessThanOrEqual(12);
		expect(motion.panel.x).toBeUndefined();
	});

	it('reduced 时两处都是 0ms', () => {
		const motion = dialogTransitions(true);
		expect(motion.backdrop.duration).toBe(0);
		expect(motion.panel.duration).toBe(0);
	});

	it('两次调用给的是独立对象——不能被组件改坏后影响下一次打开', () => {
		const first = dialogTransitions(false);
		first.panel.duration = 1;
		expect(dialogTransitions(false).panel.duration).toBe(DIALOG_DURATION);
	});
});

describe('toastTransition', () => {
	it('比弹窗更轻更快', () => {
		expect(toastTransition(false).duration).toBe(TOAST_DURATION);
		expect(toastTransition(false).duration ?? 0).toBeLessThan(DIALOG_DURATION);
	});

	it('只位移，不带缩放', () => {
		const motion = toastTransition(false);
		expect(Math.abs(px(motion.x))).toBeLessThanOrEqual(24);
		expect(Math.abs(px(motion.y))).toBeLessThanOrEqual(12);
		expect('start' in motion).toBe(false);
	});

	it('reduced 时是 0ms', () => {
		expect(toastTransition(true).duration).toBe(0);
	});
});

describe('watchReducedMotion', () => {
	it('非浏览器环境（或没有 matchMedia）按「不减少」处理，且不抛异常', () => {
		const onChange = vi.fn();
		const stop = watchReducedMotion(onChange);
		expect(onChange).toHaveBeenCalledWith(false);
		expect(() => stop()).not.toThrow();
	});

	it('查询串就是系统那个开关', () => {
		expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
	});
});
