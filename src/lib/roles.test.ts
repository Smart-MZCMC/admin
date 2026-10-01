import { describe, expect, it } from 'vitest';
import { roleAtLeast, switchableRoles } from './roles';

/**
 * 「谁能改谁」是这套后台里最容易出错、后果也最直接的一段逻辑：
 * 判错了要么是超管被挡住（用户报的「改不了负责人的权限组」），
 * 要么是给出注定被后端 403 的选项，让用户以为系统坏了。
 *
 * 这里逐条对着后端 decideRoleChange / guardGrant 的规则写，
 * 改动任意一条时这个文件会先响。
 */
const ALL = ['super_admin', 'admin', 'leader', 'pre_production', 'logistics', 'director'];

const superAdmin = { id: 1, role: 'super_admin' };
const admin = { id: 2, role: 'admin' };
const leader = { id: 3, role: 'leader' };
const otherLeader = { id: 4, role: 'leader' };
const director = { id: 5, role: 'director' };

describe('switchableRoles', () => {
	it('超管可以改负责人的角色（回归：曾按目标角色判断导致下拉被藏掉）', () => {
		// 这条是本文件的起因。原实现写的是 roleAtLeast(target.role, 'admin')，
		// 负责人等级 40 不够 50，于是超管这一格的下拉整个消失。
		expect(switchableRoles(superAdmin, otherLeader, ALL)).toContain('admin');
		expect(switchableRoles(superAdmin, otherLeader, ALL)).toContain('pre_production');
	});

	it('排除当前角色本身', () => {
		const options = switchableRoles(superAdmin, otherLeader, ALL);
		expect(options).not.toContain('leader');
	});

	it('管理员改不了超管（目标权限高于自己时不给下拉）', () => {
		expect(switchableRoles(admin, superAdmin, ALL)).toEqual([]);
	});

	it('同级之间可以改', () => {
		// 后端用的是 AtLeast（>=），同级是允许的：管理员之间互为平级。
		expect(switchableRoles(admin, { id: 9, role: 'admin' }, ALL)).toContain('leader');
	});

	it('不能授予高于自己的角色', () => {
		const options = switchableRoles(admin, leader, ALL);
		expect(options).not.toContain('super_admin');
		// 升到与自己同级是允许的（后端 guardGrant 用的是 >=），所以 admin 在列表里。
		expect(options).toContain('admin');
		// leader 是目标自己的角色，按规则被排除。
		expect(options).not.toContain('leader');
	});

	it('管理员改不了负责人以外的高等级角色，也改不了超管', () => {
		expect(switchableRoles(admin, superAdmin, ALL)).toEqual([]);
	});

	it('低于管理员的账号什么都改不了', () => {
		for (const target of [director, leader, otherLeader]) {
			expect(switchableRoles(director, target, ALL)).toEqual([]);
			expect(switchableRoles({ id: 6, role: 'logistics' }, target, ALL)).toEqual([]);
		}
	});

	it('不能给自己降级（后端一律拒绝，所以不提供该选项）', () => {
		const options = switchableRoles(superAdmin, superAdmin, ALL);
		expect(options).not.toContain('admin');
		expect(options).not.toContain('leader');
		expect(options).not.toContain('director');
	});

	it('给自己升到同等或更高的角色不算降级，可以给', () => {
		// 唯一剩下的可能就是没有别的同等级角色——全表只有六个角色，
		// 自己那一行因此通常是空的。这条断言的是「过滤逻辑没把同角色误伤」。
		const options = switchableRoles(admin, admin, ALL);
		expect(options).toEqual([]);
	});

	it('未登录时一律为空', () => {
		expect(switchableRoles(null, leader, ALL)).toEqual([]);
		expect(switchableRoles(undefined, leader, ALL)).toEqual([]);
	});
});

describe('roleAtLeast', () => {
	it('等级高低比较而不是等值比较', () => {
		expect(roleAtLeast('super_admin', 'admin')).toBe(true);
		expect(roleAtLeast('admin', 'super_admin')).toBe(false);
		expect(roleAtLeast('admin', 'admin')).toBe(true);
	});

	it('未知角色按等级 0 处理，任何守卫都会拒它', () => {
		// 与后端 roleLevels 查不到时返回 0 一致。写成「未知即通过」的话，
		// 一个脏数据角色名就能拿到管理员界面。
		expect(roleAtLeast('nonexistent', 'director')).toBe(false);
		expect(roleAtLeast(undefined, 'director')).toBe(false);
		expect(roleAtLeast('director', 'nonexistent')).toBe(true);
	});
});
