/**
 * 角色的展示辅助。
 *
 * 之前每个页面各自写一份 `role === 'admin' ? '管理员' : '导播'`，
 * 加了超级管理员之后全部会把超管显示成「导播」。这里集中成一处。
 *
 * 中文名优先取后端给的（ListUsers 的 role_label、/api/roles 的 label）——
 * 后端才是唯一事实来源；本地表只在接口没给时兜底。
 */
import { ROLE_LABELS, ROLE_LEVELS, type Role } from '$lib/api/types';

/** Tag 组件支持的配色。 */
export type RoleTagState = 'theme' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

/** 把角色翻成中文。未知值原样返回，便于排查脏数据。 */
export function roleLabel(role: string): string {
	return ROLE_LABELS[role as Role] ?? role;
}

/** 本地判断是否达到某角色等级，语义与后端 Role.AtLeast 一致。 */
export function roleAtLeast(role: string | undefined, min: Role): boolean {
	if (!role) return false;
	return (ROLE_LEVELS[role as Role] ?? 0) >= ROLE_LEVELS[min];
}

/**
 * 角色对应的标签配色：权限越高颜色越醒目。
 *
 * 未知角色用 neutral——刻意不给 theme（那是有含义的主色），
 * 一眼能看出这是个不该出现的值。
 */
const roleStates: Record<Role, RoleTagState> = {
	super_admin: 'error',
	admin: 'warning',
	leader: 'info',
	pre_production: 'theme',
	logistics: 'neutral',
	director: 'success'
};

export function roleState(role: string): RoleTagState {
	return roleStates[role as Role] ?? 'neutral';
}

/** 「超管」「管理员」这类短标签，用于空间紧凑的地方（表格单元）。 */
const shortLabels: Record<Role, string> = {
	super_admin: '超管',
	admin: '管理员',
	leader: '负责人',
	pre_production: '前期',
	logistics: '后勤',
	director: '导播'
};

export function roleShortLabel(role: string): string {
	return shortLabels[role as Role] ?? role;
}
