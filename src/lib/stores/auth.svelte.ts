/**
 * Authentication state. The JWT lives in localStorage so the session survives a
 * reload, exactly like the original single-file admin page did.
 */
import { browser } from '$app/environment';
import { api, clearToken, getToken, setToken } from '$lib/api/client';
import type { AuthUser, Role } from '$lib/api/types';
import { roleAtLeast } from '$lib/roles';

interface AuthState {
	user: AuthUser | null;
	/** True until the stored token has been checked against /api/auth/profile. */
	loading: boolean;
}

function createAuthStore() {
	let user = $state<AuthUser | null>(null);
	let loading = $state(true);
	let restoring: Promise<void> | null = null;

	/** Safe to call from several components: the profile request runs once. */
	function restore(): Promise<void> {
		if (restoring) return restoring;
		restoring = (async () => {
			if (!browser) return;
			if (!getToken()) {
				loading = false;
				return;
			}
			try {
				user = await api.profile();
			} catch {
				clearToken();
				user = null;
			} finally {
				loading = false;
			}
		})();
		return restoring;
	}

	async function login(username: string, password: string): Promise<AuthUser> {
		// 走 adminLogin：它比通用登录多一道角色门槛，「谁不能进后台」由后端
		// 的 ADMIN_MIN_ROLE 一处决定，前端不复制一份角色表。
		const result = await api.adminLogin(username, password);
		setToken(result.token);
		user = result.user;
		loading = false;
		return result.user;
	}

	/**
	 * 保存更新后的用户信息。
	 *
	 * 改邮箱或显示名后要同步到本地状态，否则界面上的头像与名字会一直显示
	 * 旧值，得等下次刷新页面才更新。
	 */
	async function updateProfile(payload: {
		display_name?: string;
		email?: string;
	}): Promise<AuthUser> {
		const updated = await api.updateProfile(payload);
		user = updated;
		return updated;
	}

	/**
	 * 修改密码。
	 *
	 * 后端会递增 token_version 让所有旧令牌失效，同时返回一个新令牌。
	 * 必须立刻用新的覆盖旧的——否则当前设备会被自己刚改的密码踢到登录页。
	 */
	async function changePassword(currentPassword: string, newPassword: string): Promise<AuthUser> {
		const result = await api.changePassword(currentPassword, newPassword);
		setToken(result.token);
		user = result.user;
		return result.user;
	}

	function logout(): void {
		clearToken();
		user = null;
	}

	return {
		get user() {
			return user;
		},
		get loading() {
			return loading;
		},
		/**
		 * 是否达到某个角色等级。
		 *
		 * 用等级而不是 `role === 'admin'` 的等值比较：后端的路由守卫已经改成
		 * 等级制（RequireRole 收的是「最低要求」），前端若还用等值判断，
		 * 超级管理员反而会被当成无权访问——两边语义不一致会直接表现为
		 * 「超管进不去管理页」。
		 */
		atLeast(min: Role): boolean {
			return roleAtLeast(user?.role, min);
		},
		/** 管理员及以上：用户管理、项目管理、权限分配、日志清理。 */
		get isAdmin() {
			return roleAtLeast(user?.role, 'admin');
		},
		/** 负责人及以上：额外可以导出数据。 */
		get isLeader() {
			return roleAtLeast(user?.role, 'leader');
		},
		/** 超级管理员：系统信息与在线更新。 */
		get isSuperAdmin() {
			return roleAtLeast(user?.role, 'super_admin');
		},
		restore,
		login,
		updateProfile,
		changePassword,
		logout
	};
}

export const auth = createAuthStore();
