import { describe, expect, it } from 'vitest';
import {
	componentState,
	componentStatusLabel,
	diskTone,
	formatBytes,
	formatTime,
	formatUptime,
	heapUsedPercent,
	memoryTone
} from './format-metrics';

/**
 * 监控页的格式化函数最容易出「0 显示成空白」「NaN%」「undefined GB」这类问题。
 *
 * 而它们在页面上只表现为一行奇怪的字：截图发给谁看都看不出是哪一步算错的，
 * 往往是有人问「这页怎么显示成这样」才被发现。所以这里逐个钉住边界。
 */
describe('formatBytes', () => {
	it('小于 1KB 显示字节', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(0)).toBe('0 B');
	});

	it('按 1024 进制逐级进位', () => {
		expect(formatBytes(1024)).toBe('1.0 KB');
		expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
		expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
		expect(formatBytes(39.01 * 1024 * 1024 * 1024)).toBe('39.0 GB');
	});

	it('三位数以上不显示小数，避免窄面板里换行', () => {
		expect(formatBytes(512 * 1024 * 1024)).toBe('512 MB');
	});

	it('缺失或非法值显示破折号而不是 NaN', () => {
		expect(formatBytes(undefined)).toBe('—');
		expect(formatBytes(null)).toBe('—');
		expect(formatBytes(Number.NaN)).toBe('—');
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
	});
});

describe('formatUptime', () => {
	it('分与秒补零到两位', () => {
		// 这条防的是「1h5m3s」这种读起来要重新对位的写法
		expect(formatUptime(3600 + 5 * 60 + 3)).toBe('1h05m03s');
		expect(formatUptime(1223 * 3600 + 21 * 60 + 29)).toBe('1223h21m29s');
	});

	it('不足一小时不编小时段', () => {
		expect(formatUptime(59)).toBe('0h00m59s');
		expect(formatUptime(0)).toBe('0h00m00s');
	});

	it('负数与非法值显示破折号', () => {
		expect(formatUptime(-1)).toBe('—');
		expect(formatUptime(Number.NaN)).toBe('—');
		expect(formatUptime(undefined)).toBe('—');
	});
});

describe('formatTime', () => {
	it('空值与非法时间戳显示破折号而不是 Invalid Date', () => {
		expect(formatTime(undefined)).toBe('—');
		expect(formatTime('')).toBe('—');
		expect(formatTime('not-a-date')).toBe('—');
	});

	it('合法时间戳转本地可读时间', () => {
		expect(formatTime('2026-08-13T13:04:19+08:00')).toContain('2026');
	});
});

describe('heapUsedPercent', () => {
	it('分母是「堆可用部分」而不是 Sys', () => {
		// Sys 含代码段与栈，拿它当分母会让刚启动的服务显得占用很高。
		// 这里 Sys=1000、栈=200，堆可用只有 800，堆占了 400 -> 50%。
		expect(
			heapUsedPercent({
				sys_bytes: 1000,
				stack_inuse_bytes: 200,
				heap_alloc_bytes: 400
			})
		).toBe(50);
	});

	it('分母不为正时返回 0 而不是 Infinity/NaN', () => {
		expect(heapUsedPercent({ sys_bytes: 200, stack_inuse_bytes: 200, heap_alloc_bytes: 10 })).toBe(
			0
		);
		expect(heapUsedPercent({ sys_bytes: 0, stack_inuse_bytes: 0, heap_alloc_bytes: 10 })).toBe(0);
	});
});

describe('配色阈值', () => {
	it('磁盘 80% 起警告、90% 转错误', () => {
		expect(diskTone(0)).toBe('primary');
		expect(diskTone(79.9)).toBe('primary');
		expect(diskTone(80)).toBe('warning');
		expect(diskTone(89.9)).toBe('warning');
		expect(diskTone(90)).toBe('error');
		expect(diskTone(100)).toBe('error');
	});

	it('内存阈值比磁盘低，因为常驻进程不会自己缩回去', () => {
		expect(memoryTone(59.9)).toBe('primary');
		expect(memoryTone(60)).toBe('warning');
		expect(memoryTone(85)).toBe('error');
	});

	it('非法百分比不改变配色', () => {
		expect(diskTone(Number.NaN)).toBe('primary');
		expect(memoryTone(Number.NaN)).toBe('primary');
	});

	it('组件状态映射到 Tag 配色，未知状态走 info', () => {
		expect(componentState('running')).toBe('success');
		expect(componentState('connected')).toBe('success');
		expect(componentState('degraded')).toBe('warning');
		expect(componentState('error')).toBe('error');
		expect(componentState('disabled')).toBe('neutral');
		expect(componentState('brand-new-state')).toBe('info');
	});

	it('未知状态原样透出，方便发现后端加了新取值', () => {
		expect(componentStatusLabel('degraded')).toBe('降级');
		expect(componentStatusLabel('brand-new-state')).toBe('brand-new-state');
	});
});
