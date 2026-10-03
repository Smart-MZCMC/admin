/**
 * Authentication state. The JWT lives in localStorage so the session survives a
 * reload, exactly like the original single-file admin page did.
 *
 * 登录态由两部分组成，**同生共死**：`user`（我是谁）与 `permissions`（我能干什么）。
 * 后端把路由准入换成了 app/rbac 的具名权限之后，界面判断「该不该显示这个按钮」
 * 必须问权限名——角色名与权限名之间没有任何映射关系，权限迁移后两头都会错。
 * 转换规则本身（纯函数，便于单测）见 $lib/auth_state。
 */
import { browser } from '$app/environment';
import { api, clearToken, getToken, onSessionLost, setToken } from '$lib/api/client';
import type { AuthUser, Role } from '$lib/api/types';
import { signedIn, signedOut, knownPermissions, type AuthSnapshot } from '$lib/auth_state';
import { hasPermission } from '$lib/rbac';
import { roleAtLeast, type RoleActor } from '$lib/roles';

function createAuthStore() {
	let user = $state<AuthUser | null>(null);
	let permissions = $state<AuthSnapshot['permissions']>([]);
	let loading = $state(true);
	let restoring: Promise<void> | null = null;

	/** 令牌失效（401）时把用户与权限一起清掉，见 auth_state 的不变量。 */
	function dropSession(): void {
		apply(signedOut());
		loading = false;
	}

	onSessionLost(dropSession);

	/** 用户与权限必须同时写入——分开赋值就等于给错位状态开了口子。 */
	function apply(next: AuthSnapshot): void {
		user = next.user;
		permissions = next.permissions;
	}

	/**
	 * 拉当前账号的生效权限。
	 *
	 * 失败时按「一项都没有」返回（fail-closed），**不抛**：令牌还有效、只是这个
	 * 接口没答上来。此时侧边栏会空掉，用户一眼看得出「没权限」，而把失败当成
	 * 会话过期会在他明明还有效令牌时把他弹回登录页。
	 */
	async function fetchPermissions(): Promise<AuthSnapshot['permissions']> {
		try {
			return knownPermissions((await api.permissions()).permissions);
		} catch {
			return [];
		}
	}

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
				// 权限一起恢复：loading 置 false 之前拿齐，路由守卫才不会先闪一屏
				// 「没有访问权限」再变出菜单。
				const profile = await api.profile();
				apply(signedIn(profile, await fetchPermissions()));
			} catch {
				clearToken();
				dropSession();
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
		// 令牌先换到手，否则紧接着那次 /api/auth/permissions 还是匿名请求。
		apply(signedIn(result.user, await fetchPermissions()));
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
		dropSession();
	}

	return {
		get user() {
			return user;
		},
		get loading() {
			return loading;
		},
		/** 后端下发的生效权限。登录态失效时它与 user 一起归零。 */
		get permissions() {
			return permissions;
		},
		/**
		 * 界面统一用这个判断「该不该显示/允许这个按钮」。
		 *
		 * 收字符串而不是 Permission：调用点拿到的多半是别处算出来的名字，
		 * 硬收字面量联合只会逼出一堆无用的 as 断言。真正的拼写防护在
		 * PERMISSIONS 与 PAGE_PERMISSIONS 的类型上，rbac.test.ts 还会再查一遍。
		 */
		can(perm: string): boolean {
			return hasPermission(permissions, perm);
		},
		/**
		 * 「能否操作他人」判断需要的全部信息：id、角色、生效权限。
		 *
		 * 每次访问返回新对象，所以别把它放进 $derived（那样每次都会判为已变）。
		 * 需要派生时在调用点自己 $derived.by 一份。
		 */
		get actor(): RoleActor {
			return { id: user?.id ?? 0, role: user?.role ?? '', permissions };
		},
		/**
		 * 是否达到某个角色等级。
		 *
		 * ⚠️ **只用于控制器层语义**（「能不能授予不高于自己的角色」这类判断，
		 *    与后端 guardGrant / decideRoleChange 同一套规则），**不用于准入**。
		 *    后端的路由准入早就换成具名权限了；拿等级判断「该不该显示这个按钮」
		 *    正是权限迁移后负责人「看不到入口 / 点了 403」的根因。
		 */
		atLeast(min: Role): boolean {
			return roleAtLeast(user?.role, min);
		},
		restore,
		login,
		updateProfile,
		changePassword,
		logout
	};
}

export const auth = createAuthStore();
