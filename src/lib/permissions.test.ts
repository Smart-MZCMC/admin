import { describe, expect, it } from 'vitest';
import { PAGE_PERMISSIONS, canVisit, minRoleFor } from './permissions';

/**
 * 这张表同时被侧边栏（决定显示哪些入口）与路由守卫（决定直接输地址时拦不拦）
 * 使用。两边对不上就会出现「菜单里没有、但地址栏能进」的页面，所以：
 *  1. 路径必须唯一且都归一化（带不带结尾斜杠都能查到）；
 *  2. 门槛必须是合法角色名——手滑写个 'superAdmin' 会让这个页面对所有人关闭，
 *     而且界面上只会显示「权限不足」，没人想得到是拼写错了。
 */
const ROLES = [
	'super_admin',
	'admin',
	'leader',
	'pre_production',
	'logistics',
	'director'
] as const;

describe('PAGE_PERMISSIONS', () => {
	it('路径不重复', () => {
		const paths = PAGE_PERMISSIONS.map((p) => p.path);
		expect(new Set(paths).size).toBe(paths.length);
	});

	it('门槛都是合法角色名', () => {
		for (const p of PAGE_PERMISSIONS) {
			if (p.min === undefined) continue;
			expect(ROLES, `${p.path} 的门槛 ${p.min} 不是合法角色`).toContain(p.min);
		}
	});

	it('结尾斜杠不影响查找', () => {
		expect(minRoleFor('/users/')).toBe(minRoleFor('/users'));
		expect(minRoleFor('/users')).toBe('admin');
		expect(minRoleFor('')).toBe(minRoleFor('/'));
	});
});

describe('canVisit', () => {
	it('没设门槛的页面登录即可', () => {
		expect(minRoleFor('/profile')).toBeUndefined();
		expect(canVisit('director', '/profile')).toBe(true);
	});

	it('系统设置只有超管能进', () => {
		expect(canVisit('super_admin', '/settings')).toBe(true);
		expect(canVisit('admin', '/settings')).toBe(false);
		expect(canVisit('leader', '/settings')).toBe(false);
		expect(canVisit('director', '/settings')).toBe(false);
	});

	it('用户/项目/权限分配需要管理员及以上', () => {
		for (const path of ['/users', '/projects', '/assign']) {
			expect(canVisit('super_admin', path), path).toBe(true);
			expect(canVisit('admin', path), path).toBe(true);
			expect(canVisit('leader', path), path).toBe(false);
			expect(canVisit('director', path), path).toBe(false);
		}
	});

	it('日志审计负责人及以上可看（值班时要看得见谁做了什么）', () => {
		expect(canVisit('leader', '/logs')).toBe(true);
		expect(canVisit('admin', '/logs')).toBe(true);
		expect(canVisit('logistics', '/logs')).toBe(false);
	});

	it('未登录一律不可访问需要门槛的页面', () => {
		expect(canVisit(undefined, '/users')).toBe(false);
		expect(canVisit('', '/settings')).toBe(false);
	});

	it('未知路径不设门槛（登录即可，由页面自己处理 404）', () => {
		expect(minRoleFor('/nowhere')).toBeUndefined();
	});
});
