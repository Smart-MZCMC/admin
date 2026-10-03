import { describe, expect, it } from 'vitest';
import { isSessionLost, NO_SESSION_PATHS, shouldEndSession } from './session';

/**
 * 「失败之后要不要把人踢回登录页」这条规则的每一档。
 *
 * 判错的代价是双向的，而错的方向更坏的那一侧曾经真的发生过：权限编辑页在一次
 * 普通的 400（unknown_role，「你选的角色不存在」）之后把人踢去登录页，
 * 于是「刷新页面后再试」这句话一次也显示不出来——用户刷一百次登录也刷不出来。
 *
 * 纯函数化的理由与 $lib/rbac-matrix 相同：它决定的是「界面还留不留得住」，
 * 错判的表现却只在浏览器里出现（单测全绿、页面照样被登出）。
 */
describe('isSessionLost', () => {
	it('只有 401 算会话失效', () => {
		expect(isSessionLost(401)).toBe(true);
	});

	it('403 是权限状态，不是会话状态', () => {
		expect(isSessionLost(403)).toBe(false);
	});

	it('业务错误与服务端错误一律不是会话失效', () => {
		// 400 unknown_role / unknown_permission：请求本身不合法，令牌是好的。
		expect(isSessionLost(400)).toBe(false);
		expect(isSessionLost(404)).toBe(false);
		// 409 policy_conflict：写进去了但重载不过，已回滚；令牌是好的。
		expect(isSessionLost(409)).toBe(false);
		// 422 / 429 / 500 / 502 / 503 / 504：网关与后端的问题。
		for (const status of [422, 429, 500, 502, 503, 504]) {
			expect(isSessionLost(status)).toBe(false);
		}
	});

	it('网络层失败用的 0 也不是会话失效（那是「连不上」）', () => {
		expect(isSessionLost(0)).toBe(false);
	});
});

describe('shouldEndSession', () => {
	const policyPut = '/api/rbac/roles/admin/permissions';

	it('令牌失效且不是登录类接口 → 结束会话', () => {
		expect(shouldEndSession('/api/auth/profile', 401)).toBe(true);
		expect(shouldEndSession(policyPut, 401)).toBe(true);
	});

	it('登录与初始化向导的 401 不能结束会话（否则刚填的内容全丢）', () => {
		for (const path of NO_SESSION_PATHS) {
			expect(shouldEndSession(path, 401)).toBe(false);
		}
		expect(NO_SESSION_PATHS.has('/api/auth/login')).toBe(true);
		expect(NO_SESSION_PATHS.has('/api/setup/apply')).toBe(true);
	});

	it('权限编辑的五种失败类别一个都不结束会话', () => {
		// 与后端 rbac_controller 的 policyErrorResponse 一一对应：
		// protected 403 / unknown_role 400 / unknown_permission 400 /
		// policy_conflict 409 / policy_unavailable 503。
		// 其中 403 本来就被旧实现排除，另外四个曾经会把人踢去登录页。
		const cases: [number, string][] = [
			[403, 'protected'],
			[400, 'unknown_role'],
			[400, 'unknown_permission'],
			[409, 'policy_conflict'],
			[503, 'policy_unavailable']
		];
		for (const [status, code] of cases) {
			expect(shouldEndSession(policyPut, status), `${code} (HTTP ${status})`).toBe(false);
		}
	});

	it('网关返回 HTML 502 也不能结束会话：令牌还在，只是中间有人坏了', () => {
		expect(shouldEndSession(policyPut, 502)).toBe(false);
		expect(shouldEndSession('/api/system/metrics', 502)).toBe(false);
	});
});
