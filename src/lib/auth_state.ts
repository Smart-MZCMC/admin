/**
 * 登录态的快照与状态转换（纯函数）。
 *
 * 为什么单独一个文件：它刻意**不 import 任何 `$app/*`**，因此能落在 vitest 的
 * node project 里被直接单测；而 auth store 本体依赖 $app/environment 与
 * fetch 包装，测试它就得把整个运行环境搭起来。
 *
 * 真正的判定方是 auth store（$lib/stores/auth.svelte.ts），这里只描述「登录态
 * 在几次转换之后应该长什么样」。它存在的意义是把一条不变量写下来：
 *
 *   **用户与权限必须同时存在、同时消失。**
 *
 * 只清一半就是错位状态：只留权限 → 令牌已失效而界面仍按旧权限摆按钮，用户
 * 点下去拿到的是 401/403，且没有任何界面告诉他「你的登录已经过期」；只留用户
 * → 侧边栏空掉但人还停在页面上，看起来像「按权限显示菜单没实装」。
 */
import type { AuthUser } from '$lib/api/types';
import { PERMISSIONS, type Permission } from '$lib/rbac';

/** 登录态快照。permissions 永远与 user 同生共死（见文件头的不变量）。 */
export interface AuthSnapshot {
	user: AuthUser | null;
	/** 后端 GET /api/auth/permissions 下发的生效权限。 */
	permissions: readonly Permission[];
}

/** 空登录态。 */
function empty(): AuthSnapshot {
	return { user: null, permissions: [] };
}

/**
 * 登录成功 / 会话恢复成功后的状态。
 *
 * 权限走一遍 knownPermissions 而不是原样存：后端只会下发已声明的权限名，
 * 万一策略文件里有脏数据，留在列表里既没有意义，也会在别处被当成有效权限。
 * 顺手也把顺序归一成 PERMISSIONS 的声明顺序，便于对照排查。
 */
export function signedIn(user: AuthUser, permissions: readonly string[]): AuthSnapshot {
	return { user, permissions: knownPermissions(permissions) };
}

/**
 * 会话失效（401）或主动退出后的状态。
 *
 * 不接收上一个状态是有意的：这条转换**不允许**从旧状态里继承任何东西。
 * 写成 `signedOut(previous)` 然后「保留 previous.permissions」正是那个
 * 已经发生过的 bug 的形状，所以签名上就不给它继承的机会。
 */
export function signedOut(): AuthSnapshot {
	return empty();
}

/** 只保留已声明的权限名，并按 PERMISSIONS 的声明顺序排列。 */
export function knownPermissions(list: readonly string[] | null | undefined): Permission[] {
	if (!list) return [];
	return PERMISSIONS.filter((perm) => list.includes(perm));
}
