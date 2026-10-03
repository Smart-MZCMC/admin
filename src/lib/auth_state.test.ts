import { describe, expect, it } from 'vitest';
import type { AuthUser } from './api/types';
import { knownPermissions, signedIn, signedOut } from './auth_state';
import { PERMISSIONS, hasPermission } from './rbac';

/**
 * 登录态的两条不变量，单测钉死：
 *
 *  1. **用户与权限同生共死。** 只清一半就是错位状态：只留权限 → 令牌已失效而
 *     界面仍按旧权限摆按钮，用户点下去拿到的是 401/403，且没有任何界面告诉他
 *     「登录已经过期」；只留用户 → 侧边栏空掉但人还停在页面上，看起来像
 *     「按权限显示菜单没实装」。
 *  2. 权限清单只认已声明的权限名，且顺序按 PERMISSIONS 归一。
 *
 * 判定逻辑刻意放在 $lib/auth_state（不 import 任何 $app/*）就是为了能在这里被
 * 直接单测；auth store 本体依赖 fetch 与浏览器环境，测它得把整套环境搭起来。
 */

function userFixture(role: AuthUser['role'] = 'leader'): AuthUser {
	return {
		id: 3,
		username: 'leader01',
		display_name: '负责人',
		role,
		email: '',
		avatar_url: '',
		role_label: '负责人'
	};
}

/** 一个「什么权限都有」的账号，用来证明清空动作真的清空了。 */
const FULLY_GRANTED = [...PERMISSIONS];

describe('signedIn', () => {
	it('用户与权限一起写入', () => {
		const user = userFixture();
		const next = signedIn(user, ['user.view', 'log.view']);
		expect(next.user).toBe(user);
		expect(next.permissions).toEqual(['log.view', 'user.view']);
	});

	it('丢掉未声明的权限名（后端策略里的脏数据不该流进界面）', () => {
		const next = signedIn(userFixture(), ['user.view', 'user.managee', '', 'log.view']);
		expect(next.permissions).toEqual(['log.view', 'user.view']);
	});

	it('权限顺序按声明顺序归一，与后端下发顺序无关', () => {
		const next = signedIn(userFixture(), ['system.maintain', 'user.view', 'log.view']);
		expect(next.permissions).toEqual(['log.view', 'user.view', 'system.maintain']);
	});
});

/**
 * 令牌失效（401）与主动退出走同一条转换：signedOut()。
 *
 * 它不接收上一个状态，是有意的——那条转换**不允许**从旧状态继承任何东西。
 * 「保留 previous.permissions」正是那个已经发生过的 bug 的形状，所以签名上
 * 就不给它继承的机会。
 */
describe('令牌失效时权限被清空', () => {
	it('退出后没有任何权限可用', () => {
		// 无论之前拿到过什么权限（这里给全套），退出后 12 项逐项都过不去。
		const previous = signedIn(userFixture(), FULLY_GRANTED);
		expect(previous.permissions).toHaveLength(12);

		const next = signedOut();
		expect(next.permissions).toEqual([]);
		for (const perm of PERMISSIONS) {
			expect(hasPermission(next.permissions, perm), perm).toBe(false);
		}
	});

	it('退出后用户也没了——不能只清一半', () => {
		// 权限清空但人还留着，看起来像「按权限显示菜单没实装」；
		// 人清空了权限还留着，则每个按钮点了都是 401。
		expect(signedOut().user).toBeNull();
		expect(signedOut().permissions).toEqual([]);
	});

	it('退出后再登录拿回的是**新**账号的权限，而不是旧的残留', () => {
		// 模拟「换账号登录」：退出 → 换一个权限面完全不同的账号进来。
		const before = signedOut();
		const after = signedIn(userFixture('director'), ['log.view', 'project.view']);
		expect(after.user?.role).toBe('director');
		expect(hasPermission(after.permissions, 'user.view')).toBe(false);
		expect(hasPermission(before.permissions, 'log.view')).toBe(false);
	});
});

describe('knownPermissions', () => {
	it('空/null/undefined 一律得到空清单', () => {
		expect(knownPermissions([])).toEqual([]);
		expect(knownPermissions(null)).toEqual([]);
		expect(knownPermissions(undefined)).toEqual([]);
	});

	it('去重并按声明顺序排列', () => {
		// 后端不会发重复项，但去重是免费的：重复会让「权限数量」这类展示算错。
		expect(knownPermissions(['user.view', 'user.view', 'log.view'])).toEqual([
			'log.view',
			'user.view'
		]);
	});
});
