import { describe, expect, it } from 'vitest';
import { checkVersion, compareVersions } from './version';

/**
 * 版本比较是这个功能的核心：横幅要不要出现、出现时提示「该升哪一边」全看它。
 * 错了的后果是给现场一个方向相反的指引（该升后端却让升客户端）。
 */
describe('compareVersions', () => {
	it('按三段数字比较', () => {
		expect(compareVersions('1.2.0', '1.1.0')).toBe(1);
		expect(compareVersions('1.1.0', '1.2.0')).toBe(-1);
		expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
		expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
		expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
	});

	it('容忍 v 前缀', () => {
		expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
		expect(compareVersions('v1.3.0', 'v1.2.0')).toBe(1);
	});

	it('段数不足按补零处理', () => {
		// 后端 Version 可能是 1.2 这种写法，不能因此判成「不可比」
		expect(compareVersions('1.2', '1.1.9')).toBe(1);
		expect(compareVersions('1.2.0', '1.2')).toBe(0);
		expect(compareVersions('1', '1.0.0')).toBe(0);
	});

	it('无法解析时返回 null 而不是猜', () => {
		expect(compareVersions('', '1.0.0')).toBeNull();
		expect(compareVersions('1.0.0', '')).toBeNull();
		expect(compareVersions('dev', '1.0.0')).toBeNull();
		expect(compareVersions('1.2.3.4', '1.2.3')).toBeNull();
		expect(compareVersions('x.y.z', '1.0.0')).toBeNull();
	});

	it('忽略预发布标记', () => {
		expect(compareVersions('1.2.0-rc1', '1.2.0')).toBe(0);
		expect(compareVersions('1.2.0+build5', '1.2.0')).toBe(0);
	});
});

describe('checkVersion', () => {
	it('版本相同 -> 无需提示', () => {
		expect(checkVersion('1.2.0', '1.2.0', '1.1.0').status).toBe('match');
	});

	/**
	 * 达不到最低适配版本时是 unsupported（必须更新），不是 client-behind。
	 * 这两档的区别就是「能不能继续用」，提示样式也不同。
	 */
	it('低于最低适配版本 -> 必须更新', () => {
		const s = checkVersion('1.1.0', '1.3.0', '1.2.0');
		expect(s.status).toBe('unsupported');
		expect(s.isUrgent).toBe(true);
		expect(s.shouldWarn).toBe(true);
		expect(s).toMatchObject({
			status: 'unsupported',
			client: '1.1.0',
			server: '1.3.0',
			minimum: '1.2.0'
		});
	});

	it('满足最低适配但落后于后端 -> 只是建议', () => {
		const s = checkVersion('1.2.0', '1.3.0', '1.2.0');
		expect(s.status).toBe('client-behind');
		if (s.status === 'client-behind') {
			expect(s.client).toBe('1.2.0');
			expect(s.server).toBe('1.3.0');
		}
	});

	it('客户端超前 -> 提示更新后端', () => {
		expect(checkVersion('1.3.0', '1.2.0', '1.2.0').status).toBe('client-ahead');
	});

	/**
	 * 老后端没有 min_client_version 字段。此时退化成「版本不等就提醒」，
	 * 而不是因为拿不到最低版本就什么都不说——那会让新客户端对着老后端
	 * 静默运行，出问题时反而更难查。
	 */
	it('后端未声明最低适配版本 -> 退化为单纯的不一致提示', () => {
		expect(checkVersion('1.1.0', '1.2.0').status).toBe('client-behind');
		expect(checkVersion('1.1.0', '1.2.0', '').status).toBe('client-behind');
		// 声明值本身不可解析时同样退化，而不是误判成 unsupported
		expect(checkVersion('1.1.0', '1.2.0', 'dev').status).toBe('client-behind');
	});

	/**
	 * 这是最重要的一条：开发构建没有注入版本号（appVersion 为 'dev'），
	 * 不能因此报「版本不一致」——否则每次本地开发都弹一条假告警，
	 * 真正需要提醒的现场反而被淹没。
	 */
	it('任一侧不可解析 -> unknown，不当成不一致', () => {
		expect(checkVersion('dev', '1.2.0').status).toBe('unknown');
		expect(checkVersion('', '1.2.0').status).toBe('unknown');
		expect(checkVersion('1.2.0', '').status).toBe('unknown');
		expect(checkVersion('dev', 'dev').status).toBe('unknown');
	});

	it('状态里的版本号与便捷标志都被带上，便于直接写进提示文案', () => {
		// shouldWarn / isUrgent 由 checkVersion 算好一并返回，横幅组件就不必
		// 自己再判断一遍（漏一档的后果是红色告警显示成琥珀色）。
		const s = checkVersion('1.1.0', '1.2.0', '1.1.0');
		expect(s).toMatchObject({
			status: 'client-behind',
			client: '1.1.0',
			server: '1.2.0',
			minimum: '1.1.0',
			shouldWarn: true,
			isUrgent: false
		});
	});
});
