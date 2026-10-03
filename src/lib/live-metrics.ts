/**
 * 监控页「自动刷新」与「指标变化」的纯逻辑。
 *
 * 抽出来不是为了好看，是因为这两件事最容易写出「看起来对、其实在骗人」的代码：
 * 倒计时和轮询各算各的会出现「倒计时归零了但数据没来」；值变化判断写在组件里
 * 则没法单测，而「值没变时绝不播动画」恰恰是最该被钉死的一条规则。
 */

import { componentStatusLabel } from './format-metrics';

/** 数值变化的方向。flat 表示变化了但没有可用于判断方向的数字。 */
export type ChangeDirection = 'up' | 'down' | 'flat';

export interface ValueChange {
	changed: boolean;
	direction: ChangeDirection;
}

/** 参与比较的一次读数快照。 */
export interface ValueSample {
	/**
	 * 页面上真正显示出来的那段文本。
	 *
	 * 变化与否只看它：判断「用户看到的有没有变」，而不是判断「后端字段有没有变」。
	 * 后者会把 39.01 GB 变成 39.013 GB 这种看不出差别的情况也报成一次变化，
	 * 提示一多就等于没提示。
	 */
	text: string;
	/**
	 * 用于判断方向的数字，可选。
	 *
	 * 不能拿 text 比大小：显示文本带单位与分隔符（"160 KB" / "1.2 MB"），
	 * 字典序会把 1.2 MB 判成比 160 KB 小。
	 */
	rank?: number;
}

/**
 * 判断一个读数相对上一次是否变化。
 *
 * previous 为 undefined 表示首屏还没有可比的对象，此时一律报「没变」：
 * 第一次读到数据不是「刚刚变了」，给它播一次动画就是在骗人。
 */
export function valueChange(previous: ValueSample | undefined, next: ValueSample): ValueChange {
	if (previous === undefined) return { changed: false, direction: 'flat' };
	if (previous.text === next.text) return { changed: false, direction: 'flat' };
	const before = previous.rank;
	const after = next.rank;
	if (
		typeof before !== 'number' ||
		typeof after !== 'number' ||
		!Number.isFinite(before) ||
		!Number.isFinite(after)
	) {
		// 文本变了就是变了，只是没法说清是升是降（例如一个时间戳）。
		return { changed: true, direction: 'flat' };
	}
	if (before === after) return { changed: true, direction: 'flat' };
	return { changed: true, direction: after > before ? 'up' : 'down' };
}

/** 距离预定时刻还有几秒。向上取整，展示用：刚读完时应显示 10 而不是 9。 */
export function secondsUntil(now: number, dueAt: number): number {
	return Math.max(0, Math.ceil((dueAt - now) / 1000));
}

/**
 * 进度条填充比例，0 表示刚读完，1 表示该发下一次请求了。
 *
 * intervalMs 是归一化的分母，也就是轮询间隔本身——倒计时与进度条共用这一个
 * 基准和这一个间隔，不会出现「条已经满了但数字还在数」。
 */
export function pollProgress(now: number, dueAt: number, intervalMs: number): number {
	if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
	const left = dueAt - now;
	if (left <= 0) return 1;
	return Math.min(1, Math.max(0, 1 - left / intervalMs));
}

/**
 * 距离下一次请求还要等多久（毫秒）。
 *
 * 传入的 dueAt 与倒计时、进度条用的是同一个数，所以「倒计时显示 3 秒」和
 * 「3 秒后真的发出请求」不会各算各的。下限 120ms 是为了接口慢到超过一个
 * 轮询间隔时不至于连成连发。
 */
export function nextPollDelay(now: number, dueAt: number, intervalMs: number): number {
	const floor = Math.min(120, Math.max(0, intervalMs));
	return Math.max(floor, dueAt - now);
}

/**
 * 倒计时文案。
 *
 * overdue 为 true 表示已到点：此刻请求在途（或这一轮失败了，正在等下一轮），
 * 这时候继续显示「0 秒后」会被当成卡住。
 */
export function countdownText(now: number, dueAt: number): { text: string; overdue: boolean } {
	const seconds = secondsUntil(now, dueAt);
	if (seconds > 0) return { text: `${seconds} 秒后`, overdue: false };
	return { text: '正在刷新', overdue: true };
}

/** 「12 秒前」这样的相对时间。then 无效时返回破折号。 */
export function timeAgo(now: number, then: number): string {
	if (!Number.isFinite(then) || then <= 0) return '—';
	// 时钟被往回调过时会算出负数，按「刚刚」处理而不是显示「-3 秒前」。
	const seconds = Math.floor(Math.max(0, now - then) / 1000);
	if (seconds < 1) return '刚刚';
	if (seconds < 60) return `${seconds} 秒前`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小时前`;
	return `${Math.floor(hours / 24)} 天前`;
}

/**
 * 推进中的运行时长。
 *
 * 后端给的 `uptime_seconds` 是**采集那一刻**的快照。若直接显示它，运行时间
 * 每两次轮询才跳一次秒数——一个精确到秒的读数却十秒才动一次，看起来就像坏了。
 * 而把它改成每秒轮询来换平滑，代价是每次都重跑 3 次目录递归遍历加一次 SQL 查询
 * （见后端 sysinfo），常驻占用百分之几的单核，且随日志目录增长而变贵。
 *
 * 所以正确做法是**本地推进**：记下收到响应的那一刻，之后每秒在那个锚点上加经过的
 * 时间，零网络成本。
 *
 * 锚点必须用 `receivedAt`（客户端时钟）而不是后端返回的 `collected_at`：后者是
 * **服务器**时刻，与客户端 `Date.now()` 相减会把两台机器的时钟偏差算进来——客户端
 * 快 5 分钟，运行时长就会凭空多出 5 分钟。同钟差值里偏差自动抵消，这正是选
 * receivedAt 的理由。
 *
 * 每次轮询重新锚定一次，所以定时器降频（标签页隐藏）或网络延迟都不会累积成漂移。
 * 唯一算进去的是「采集到收到」这段网络耗时，亚秒级，对秒级读数无影响。
 */
export function tickingUptime(
	baseSeconds: number | undefined | null,
	receivedAt: number,
	now: number
): number | null {
	if (baseSeconds === undefined || baseSeconds === null) return null;
	if (!Number.isFinite(baseSeconds) || baseSeconds < 0) return null;
	if (!Number.isFinite(receivedAt) || receivedAt <= 0) return null;
	if (!Number.isFinite(now)) return null;
	// 时钟被往回调过时 now < receivedAt，按 0 秒处理而不是显示倒退的时长。
	const elapsed = Math.max(0, now - receivedAt);
	return Math.floor(baseSeconds + elapsed / 1000);
}

/**
 * 只挑「事件型」指标做变化提示。
 *
 * 内存占用率、累计分配这类读数每一轮都在漂，给它们挂提示等于挂了个不停闪的
 * 挂件，管理员很快就学会忽略它，连同真正该看的那几条一起忽略。事件型的判断
 * 依据是「它变了一定发生了某件事」：客户端进出、连接断开、组件状态迁移。
 */
export interface WatchedMetrics {
	runtime: { online_count: number };
	components: { name: string; status: string }[];
	database: { ping: { connected: boolean } };
}

export interface MetricEvent {
	/** 稳定的标识，给 keyed 渲染用。 */
	key: string;
	label: string;
	direction: ChangeDirection;
}

/**
 * 本轮刷新里真正发生了什么变化。
 *
 * 只比状态不比 detail：detail 里带着 PID、在线数这类每次都不同的内容，
 * 拿它参与比较会让这个列表每轮都有话说。
 */
export function metricEvents(previous: WatchedMetrics | null, next: WatchedMetrics): MetricEvent[] {
	if (previous === null) return [];
	const events: MetricEvent[] = [];

	if (previous.runtime.online_count !== next.runtime.online_count) {
		const before = previous.runtime.online_count;
		const after = next.runtime.online_count;
		events.push({
			key: 'online',
			label: `在线客户端 ${before} → ${after}`,
			direction: after > before ? 'up' : 'down'
		});
	}

	if (previous.database.ping.connected !== next.database.ping.connected) {
		const connected = next.database.ping.connected;
		events.push({
			key: 'database',
			label: `数据库连接${connected ? '已恢复' : '已断开'}`,
			// 断开是变坏，方向与数量指标相反，所以 down 在这里表示「更差」。
			direction: connected ? 'up' : 'down'
		});
	}

	for (const component of next.components) {
		const before = previous.components.find((item) => item.name === component.name);
		if (!before || before.status === component.status) continue;
		events.push({
			key: `component:${component.name}`,
			label: `${component.name} ${componentStatusLabel(before.status)} → ${componentStatusLabel(component.status)}`,
			direction: component.status === 'running' || component.status === 'connected' ? 'up' : 'down'
		});
	}

	return events;
}

/**
 * 目录统计失败的原文换成人话。
 *
 * 直接把 Go 的报错摆在界面上，管理员既看不懂也不知道该不该处理（缺目录是
 * 正常状态，权限不足就要处理），两者被同一种样式呈现出来只会让人忽略整块内容。
 * 原文仍然保留在 title 里，排查时照着查得到。
 */
export function dirSizeErrorLabel(raw: string): string {
	const text = (raw ?? '').toLowerCase();
	if (!text) return '无法读取该目录';
	if (
		text.includes('no such file') ||
		text.includes('cannot find the file') ||
		text.includes('系统找不到指定的文件') ||
		text.includes('系统找不到指定的路径')
	) {
		return '尚未创建（属正常情况）';
	}
	if (
		text.includes('permission denied') ||
		text.includes('access is denied') ||
		text.includes('拒绝访问')
	) {
		return '无权限读取';
	}
	if (text.includes('条目超过')) return '条目过多，仅统计部分';
	if (text.includes('not a directory') || text.includes('不是目录')) return '路径不是目录';
	return '无法读取该目录';
}

/** 数据库连接失败的原文换成人话，理由与目录统计同。 */
export function dbPingErrorLabel(raw: string): string {
	const text = (raw ?? '').toLowerCase();
	if (!text) return '数据库连接不可用';
	if (
		text.includes('no such file') ||
		text.includes('cannot find the file') ||
		text.includes('unable to open database')
	) {
		return '数据库文件不存在';
	}
	if (
		text.includes('password') ||
		text.includes('authentication') ||
		text.includes('口令') ||
		text.includes('密码')
	) {
		return '账号或口令不正确';
	}
	if (text.includes('locked')) return '数据库文件被其它进程占用';
	if (text.includes('readonly') || text.includes('read-only')) return '数据库文件为只读';
	if (text.includes('no space') || text.includes('disk i/o')) return '磁盘剩余空间不足';
	if (text.includes('timeout') || text.includes('deadline')) return '连接超时';
	return '数据库连接不可用';
}
