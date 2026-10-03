/**
 * 监控页用的纯函数：格式化字节、时长、组件状态配色。
 *
 * 单独抽出来是为了能写单测——格式化逻辑最容易出现「0 显示成空白」
 * 「NaN%」「undefined GB」这类问题，而它们只在页面上表现为一行奇怪的字，
 * 截图发给谁看都看不出是哪一步算错的。
 */

/** 字节转可读字符串。1024 进制，与 df / top 一致。 */
export function formatBytes(bytes: number | undefined | null): string {
	if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) return '—';
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
	let value = bytes / 1024;
	let i = 0;
	// 到单位用完就停：超过 PB 的量级在这个系统里没有意义，硬撑只会显示
	// 「1024.0 PB」这种一看就是除错了的数字。
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i += 1;
	}
	return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

/**
 * 秒转「1223h21m29s」这样的时长。
 *
 * 分与秒都补零到两位：直播现场的记时习惯是看表盘式的对齐写法，
 * 「1h5m3s」和「1h05m03s」在快速扫一眼时的可读性差别很明显。
 */
export function formatUptime(seconds: number | undefined | null): string {
	if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds < 0) {
		return '—';
	}
	const total = Math.floor(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${h}h${pad(m)}m${pad(s)}s`;
}

/** 时间戳转本地可读时间；无效值返回破折号而不是 "Invalid Date"。 */
export function formatTime(value: string | undefined | null): string {
	if (!value) return '—';
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleString('zh-CN', { hour12: false });
}

/** 组件状态 -> Tag 的配色。 */
export function componentState(
	status: string
): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
	switch (status) {
		case 'running':
		case 'connected':
			return 'success';
		case 'degraded':
			return 'warning';
		case 'error':
			return 'error';
		case 'disabled':
			return 'neutral';
		default:
			return 'info';
	}
}

/** 组件状态的中文说明。未知状态原样透出，方便发现后端加了新取值。 */
export function componentStatusLabel(status: string): string {
	switch (status) {
		case 'running':
			return '运行中';
		case 'connected':
			return '已连接';
		case 'degraded':
			return '降级';
		case 'error':
			return '异常';
		case 'disabled':
			return '未启用';
		default:
			return status;
	}
}

/**
 * 磁盘占用率的配色阈值。
 *
 * 80% 开始警告而不是 90%：数据库、日志、发布包都在同一个分区，写满之前
 * 通常已经要开始清日志了，等到 90% 才提示就只剩十分钟的余地。
 */
export function diskTone(percent: number): 'primary' | 'warning' | 'error' {
	if (!Number.isFinite(percent)) return 'primary';
	if (percent >= 90) return 'error';
	if (percent >= 80) return 'warning';
	return 'primary';
}

/** 堆占用率的配色阈值。60% 开始警告，因为服务进程常驻、不会自己缩回去。 */
export function memoryTone(percent: number): 'primary' | 'warning' | 'error' {
	if (!Number.isFinite(percent)) return 'primary';
	if (percent >= 85) return 'error';
	if (percent >= 60) return 'warning';
	return 'primary';
}

/**
 * 堆占用率。
 *
 * 分母用「堆可用部分」而不是后端给的 Sys：Sys 含代码段与栈，刚启动时
 * 按它算会显得很高，而实际占用很少——那个数字会让人白折腾一轮。
 */
export function heapUsedPercent(memory: {
	sys_bytes: number;
	stack_inuse_bytes: number;
	heap_alloc_bytes: number;
}): number {
	const heapSys = memory.sys_bytes - memory.stack_inuse_bytes;
	if (heapSys <= 0) return 0;
	return (memory.heap_alloc_bytes / heapSys) * 100;
}
