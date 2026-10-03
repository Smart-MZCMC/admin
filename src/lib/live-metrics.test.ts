import { describe, expect, it } from 'vitest';
import {
	countdownText,
	dbPingErrorLabel,
	dirSizeErrorLabel,
	metricEvents,
	nextPollDelay,
	pollProgress,
	secondsUntil,
	tickingUptime,
	timeAgo,
	valueChange,
	type WatchedMetrics
} from './live-metrics';

/**
 * 这一页的数字每 10 秒变一次，于是有两个特别容易写错、而且错了很难看出来的地方：
 *
 * 1. 值没变时也播动画——管理员分不清「值真的变了」还是「动画在动」，几轮之后就
 *    完全不看了，等于这个提示从来没有过。
 * 2. 倒计时和轮询各算各的——倒计时归零了数据没来，界面就在骗人。
 *
 * 两件事的判断都在 live-metrics 里，这里逐条钉住。
 */

const T0 = 1_800_000_000_000;
const INTERVAL = 10_000;

describe('valueChange', () => {
	it('首次加载不算变化', () => {
		// 首屏本来就没有可比的对象。第一次读到数据不是「刚刚变了」，
		// 播一次动画就是在骗管理员。
		expect(valueChange(undefined, { text: '0h12m03s', rank: 723 })).toEqual({
			changed: false,
			direction: 'flat'
		});
	});

	it('值没变时不播动画', () => {
		expect(valueChange({ text: '160 KB', rank: 163840 }, { text: '160 KB', rank: 163840 })).toEqual(
			{ changed: false, direction: 'flat' }
		);
	});

	it('值变了才算变化，方向取自 rank 而不是显示文本', () => {
		// 显示文本比大小是错的：字典序里 '1.2 MB' < '160 KB'，
		// 真按文本判方向会把增长报成下降。
		expect(
			valueChange({ text: '160 KB', rank: 163840 }, { text: '1.2 MB', rank: 1258291 })
		).toEqual({ changed: true, direction: 'up' });
		expect(
			valueChange({ text: '1.2 MB', rank: 1258291 }, { text: '160 KB', rank: 163840 })
		).toEqual({ changed: true, direction: 'down' });
	});

	it('只有显示文本变了才算变化，后端字段的微小抖动不算', () => {
		// 39.01 GB 与 39.013 GB 在界面上是同一串字。拿原始字节比会每轮都报一次
		// 变化，提示一多就等于没提示。
		const shown = '39.0 GB';
		expect(
			valueChange({ text: shown, rank: 41_891_088_384 }, { text: shown, rank: 41_891_099_136 })
		).toEqual({ changed: false, direction: 'flat' });
	});

	it('变化了但没有可比数字时只报变化，不编方向', () => {
		expect(valueChange({ text: '00:12:03' }, { text: '00:13:41' })).toEqual({
			changed: true,
			direction: 'flat'
		});
	});
});

describe('轮询时间基准', () => {
	it('倒计时与轮询共用 dueAt，两边算出的等待时间一致', () => {
		// 这是「倒计时归零了但数据没来」的根因测试：进度条归零的时刻必须就是
		// 真正发出请求的时刻，两者都由同一个 dueAt 推出来。
		const now = T0 + 7_000;
		expect(pollProgress(now, T0 + INTERVAL, INTERVAL)).toBeCloseTo(0.7, 5);
		expect(nextPollDelay(now, T0 + INTERVAL, INTERVAL)).toBe(3_000);
		expect(
			pollProgress(now + nextPollDelay(now, T0 + INTERVAL, INTERVAL), T0 + INTERVAL, INTERVAL)
		).toBe(1);
	});

	it('刚读完时进度为 0，秒数是完整的间隔', () => {
		expect(pollProgress(T0, T0 + INTERVAL, INTERVAL)).toBe(0);
		expect(secondsUntil(T0, T0 + INTERVAL)).toBe(10);
	});

	it('超过时点后进度封顶为 1，不会算出大于 1 的比例', () => {
		expect(pollProgress(T0 + INTERVAL + 5_000, T0 + INTERVAL, INTERVAL)).toBe(1);
		expect(pollProgress(T0 + INTERVAL, T0, INTERVAL)).toBe(1);
	});

	it('间隔非法时进度为 0 而不是 NaN', () => {
		expect(pollProgress(T0, T0 + INTERVAL, 0)).toBe(0);
		expect(pollProgress(T0, T0 + INTERVAL, Number.NaN)).toBe(0);
	});

	it('接口慢到超过一个间隔时留出下限，不会连成连发', () => {
		// 一次请求跑了 40 秒而间隔是 10 秒：直接按 dueAt-now 算会得到负数，
		// 负的 setTimeout 等价于 0，于是马上又发一次，接口从此停不下来。
		expect(nextPollDelay(T0 + 40_000, T0 + 10_000, INTERVAL)).toBe(120);
		expect(nextPollDelay(T0, T0 + INTERVAL, INTERVAL)).toBe(INTERVAL);
	});

	it('间隔短于下限时以间隔为准', () => {
		expect(nextPollDelay(T0, T0 + 40, 40)).toBe(40);
	});

	it('到点后文案改成「正在刷新」，不显示 0 秒', () => {
		expect(countdownText(T0 + 2_400, T0 + INTERVAL)).toEqual({
			text: '8 秒后',
			overdue: false
		});
		expect(countdownText(T0 + INTERVAL, T0 + INTERVAL)).toEqual({
			text: '正在刷新',
			overdue: true
		});
	});

	it('相对时间跨过秒、分、时、天四个量级', () => {
		expect(timeAgo(T0, T0)).toBe('刚刚');
		expect(timeAgo(T0, T0 - 12_000)).toBe('12 秒前');
		expect(timeAgo(T0, T0 - 3 * 60_000)).toBe('3 分钟前');
		expect(timeAgo(T0, T0 - 2 * 3_600_000)).toBe('2 小时前');
		expect(timeAgo(T0, T0 - 3 * 86_400_000)).toBe('3 天前');
	});

	it('从未成功读到数据时不编造时间，时钟回拨也不显示负数', () => {
		expect(timeAgo(T0, 0)).toBe('—');
		expect(timeAgo(T0, T0 + 5_000)).toBe('刚刚');
	});
});

function watched(overrides: Partial<WatchedMetrics> = {}): WatchedMetrics {
	return {
		runtime: { online_count: 3 },
		components: [
			{ name: 'api', status: 'running' },
			{ name: 'database', status: 'connected' },
			{ name: 'storage', status: 'disabled' }
		],
		database: { ping: { connected: true } },
		...overrides
	};
}

describe('metricEvents', () => {
	it('首屏不报变化', () => {
		expect(metricEvents(null, watched())).toEqual([]);
	});

	it('没有变化时返回空数组，页面上不会出现任何提示', () => {
		expect(metricEvents(watched(), watched())).toEqual([]);
	});

	it('在线客户端进出时报一条，带方向', () => {
		expect(metricEvents(watched(), watched({ runtime: { online_count: 5 } }))).toEqual([
			{ key: 'online', label: '在线客户端 3 → 5', direction: 'up' }
		]);
		expect(metricEvents(watched(), watched({ runtime: { online_count: 1 } }))).toEqual([
			{ key: 'online', label: '在线客户端 3 → 1', direction: 'down' }
		]);
	});

	it('数据库连接断开算变坏，方向与数量指标相反', () => {
		expect(metricEvents(watched(), watched({ database: { ping: { connected: false } } }))).toEqual([
			{ key: 'database', label: '数据库连接已断开', direction: 'down' }
		]);
	});

	it('组件状态迁移逐个报出，名称保持原样', () => {
		const next = watched();
		next.components[2] = { name: 'storage', status: 'degraded' };
		expect(metricEvents(watched(), next)).toEqual([
			{
				key: 'component:storage',
				label: 'storage 未启用 → 降级',
				direction: 'down'
			}
		]);
	});

	it('只比状态不比 detail：detail 每次都变时不报', () => {
		// detail 里带着 PID、在线数这类每次都不同的内容。它一变就报，
		// 这个列表就会每轮都有话说。
		const before = watched();
		const after = watched();
		expect(metricEvents(before, after)).toEqual([]);
	});
});

describe('原始报错换成人话', () => {
	it('目录不存在按正常情况处理，权限不足要单独说', () => {
		// 这两种情况都会让同一个统计失败，但只有后者需要管理员动手。
		expect(
			dirSizeErrorLabel('GetFileAttributesEx update: The system cannot find the file specified.')
		).toBe('尚未创建（属正常情况）');
		expect(dirSizeErrorLabel('stat update: no such file or directory')).toBe(
			'尚未创建（属正常情况）'
		);
		expect(dirSizeErrorLabel('walk database: permission denied')).toBe('无权限读取');
	});

	it('认不出的原文给一句中性的说明，不把英文原样端出来', () => {
		expect(dirSizeErrorLabel('exit status 137')).toBe('无法读取该目录');
		expect(dirSizeErrorLabel('')).toBe('无法读取该目录');
		expect(dirSizeErrorLabel('条目超过 200000 个，只统计了前一部分')).toBe('条目过多，仅统计部分');
	});

	it('数据库连接失败按原因给不同说法', () => {
		expect(dbPingErrorLabel('unable to open database file')).toBe('数据库文件不存在');
		expect(dbPingErrorLabel('password authentication failed')).toBe('账号或口令不正确');
		expect(dbPingErrorLabel('database is locked')).toBe('数据库文件被其它进程占用');
		expect(dbPingErrorLabel('attempt to write a readonly database')).toBe('数据库文件为只读');
		expect(dbPingErrorLabel('no space left on device')).toBe('磁盘剩余空间不足');
		expect(dbPingErrorLabel('dial tcp 127.0.0.1:5432: i/o timeout')).toBe('连接超时');
		expect(dbPingErrorLabel('something odd')).toBe('数据库连接不可用');
	});
});

describe('tickingUptime', () => {
	// 这条规则防的是「运行时长越看越不准」。它是判断服务有没有重启过的唯一依据，
	// 一旦漂移就没有人相信监控页上的任何数字了。

	it('刚收到响应时等于后端快照值', () => {
		expect(tickingUptime(100, 1_000_000, 1_000_000)).toBe(100);
		expect(tickingUptime(100, 1_000_000, 1_000_999)).toBe(100);
	});

	it('本地每秒推进一格', () => {
		expect(tickingUptime(100, 1_000_000, 1_001_000)).toBe(101);
		expect(tickingUptime(100, 1_000_000, 1_002_500)).toBe(102);
		expect(tickingUptime(0, 1_000_000, 1_060_000)).toBe(60);
	});

	it('锚点用客户端时钟，所以客户端快 5 分钟也不影响结果', () => {
		// 若误用后端 collected_at 做基准，这里会算出 +300 秒。
		// 传进来的 receivedAt 与 now 同源，偏差在差值里抵消。
		expect(tickingUptime(1_000, 5_000_000, 5_003_000)).toBe(1_003);
	});

	it('没有数据时返回 null，由调用方显示占位符', () => {
		expect(tickingUptime(null, 1_000_000, 1_001_000)).toBeNull();
		expect(tickingUptime(undefined, 1_000_000, 1_001_000)).toBeNull();
	});

	it('时钟被往回调过时按 0 秒处理，不显示倒退的时长', () => {
		expect(tickingUptime(100, 1_000_000, 999_000)).toBe(100);
	});

	it('非法输入一律不给出时长，而不是给出 NaN', () => {
		expect(tickingUptime(Number.NaN, 1_000_000, 1_001_000)).toBeNull();
		expect(tickingUptime(-5, 1_000_000, 1_001_000)).toBeNull();
		expect(tickingUptime(100, 0, 1_001_000)).toBeNull();
		expect(tickingUptime(100, Number.NaN, 1_001_000)).toBeNull();
		expect(tickingUptime(100, 1_000_000, Number.NaN)).toBeNull();
	});
});
