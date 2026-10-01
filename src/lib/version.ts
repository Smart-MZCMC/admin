/**
 * 版本比较。
 *
 * 版本号来自两个地方：编译期注入的本端版本（`VITE_APP_VERSION` /
 * `--dart-define=APP_VERSION`）与后端 `GET /api/status` 返回的 `version`。
 * 两边不一致时界面要提示该更新哪一端，所以必须能比较大小而不是只比是否相等。
 */

/** 本端版本。由构建时注入；开发构建没有注入时是 'dev'。 */
export const appVersion = import.meta.env.VITE_APP_VERSION || 'dev';

/**
 * 解析版本号为三段数字。
 *
 * 容忍：开头的 v（tag 形式）、段数不足（1.2 视作 1.2.0）、非数字段（按 0）。
 * 返回 null 表示完全无法解析——此时不应该给出「谁新谁旧」的结论，
 * 宁可当作不可比也不要给出错误的指引。
 */
function parseVersion(version: string): [number, number, number] | null {
	const cleaned = version.trim().replace(/^v/i, '');
	if (cleaned === '') return null;
	const core = cleaned.split(/[-+]/)[0]; // 去掉预发布/构建元数据
	const parts = core.split('.');
	if (parts.length === 0 || parts.length > 3) return null;

	const out: number[] = [0, 0, 0];
	for (let i = 0; i < parts.length; i++) {
		// 必须先判空再转数字：Number('') 是 0 而不是 NaN，
		// 于是空串会被当成 0.0.0，让「开发构建没有版本号」被误判成
		// 「比服务端旧很多」，从而弹出一条方向完全错误的告警。
		const raw = parts[i].trim();
		if (raw === '') return null;
		const n = Number(raw);
		if (!Number.isFinite(n)) return null;
		out[i] = n;
	}
	return [out[0], out[1], out[2]];
}

/** 比较两个版本：-1 a 更旧，0 相同，1 a 更新。无法解析时返回 null。 */
export function compareVersions(a: string, b: string): number | null {
	const pa = parseVersion(a);
	const pb = parseVersion(b);
	if (!pa || !pb) return null;
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
	}
	return 0;
}

export type VersionState =
	| { status: 'unknown' }
	/** 客户端在最低适配版本之上，且不低于后端。 */
	| { status: 'match' }
	/**
	 * 客户端低于后端声明的最低适配版本：老版本会有功能异常，**必须**更新。
	 * 这是唯一值得用醒目样式提示的一档。
	 */
	| { status: 'unsupported'; client: string; server: string; minimum: string }
	/**
	 * 满足最低要求、只是落后于后端：建议更新，不影响使用。
	 *
	 * minimum 也带上：调用点想区分「最低适配版本是多少」时不必再单独算一遍。
	 */
	| { status: 'client-behind'; client: string; server: string; minimum: string }
	/** 本端新于后端：服务端可能缺少接口，该更新后端。 */
	| { status: 'client-ahead'; client: string; server: string; minimum: string };

/**
 * 判断结果上的便捷取值。
 *
 * 做成成员而不是让每个调用点写 status === 'x'：横幅组件要判断三件事
 * （要不要显示、是不是紧急），漏一处就是「红色告警显示成琥珀色」。
 */
export type VersionStateWithFlags = VersionState & {
	/** 是否需要显示提示。 */
	shouldWarn: boolean;
	/** 是否意味着「现在就有功能异常」，界面该用醒目样式。 */
	isUrgent: boolean;
};

/**
 * 比对本端、后端与「最低适配版本」。
 *
 * 为什么不能简单地「两端不等就告警」：后端发新版不代表客户端必须跟着重建。
 * 改个文案、修个 bug 对客户端完全透明，那样每次发版都会把所有客户端提醒一遍，
 * 久而久之这个提示就没人看了 —— 告警只有在该响的时候响才有意义。
 *
 * 所以分两档（见后端 status_controller.go 的 MinClientVersion 说明）：
 *   - 低于最低适配版本 → unsupported，必须更新
 *   - 满足最低要求但落后于后端 → client-behind，只是建议
 *
 * 任一侧不可解析（开发构建的 'dev'、后端没返回该字段）都归为 unknown 而**不是**
 * 报不一致：否则每次本地开发都会弹一条假告警，真正需要提醒的正式部署反而被淹没。
 * 老版本后端没有 min_client_version 字段，此时退化为「只要不等就提醒」。
 */
export function checkVersion(
	client: string,
	server: string,
	minClientVersion?: string
): VersionStateWithFlags {
	const minimum = minClientVersion ?? '';
	// shouldWarn / isUrgent 一律算好返回：横幅组件判断三件事时不会漏掉哪一档。
	const finish = (s: VersionState): VersionStateWithFlags => ({
		...s,
		shouldWarn: s.status !== 'match' && s.status !== 'unknown',
		isUrgent: s.status === 'unsupported'
	});

	if (!client || !server) return finish({ status: 'unknown' });

	const cmpToServer = compareVersions(client, server);
	if (cmpToServer === null) return finish({ status: 'unknown' });

	if (cmpToServer === 0) return finish({ status: 'match' });
	if (cmpToServer > 0) return finish({ status: 'client-ahead', client, server, minimum });

	// 客户端落后于后端。接下来看它是否还满足最低适配要求。
	if (minimum) {
		const cmpToMin = compareVersions(client, minimum);
		if (cmpToMin !== null && cmpToMin < 0) {
			return finish({ status: 'unsupported', client, server, minimum });
		}
	}
	return finish({ status: 'client-behind', client, server, minimum });
}
