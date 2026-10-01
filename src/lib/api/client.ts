/**
 * Thin fetch wrapper over the Go backend's REST API.
 *
 * The admin app is served by the same Go binary that serves the API, so a
 * same-origin base is correct in production. During `vite dev` the app runs on
 * a different port, so set `PUBLIC_API_BASE` (e.g. http://127.0.0.1:3000) to
 * point at the backend.
 */
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type {
	ApplyUpdateResult,
	AuditLogsResponse,
	AuthUser,
	ChangePasswordResponse,
	CleanupResult,
	ExportResult,
	HealthStatus,
	LoginResponse,
	LogsResponse,
	Message,
	PluginInfo,
	Project,
	ProjectCamera,
	ProjectStats,
	RoleInfo,
	ServerStatus,
	SetupApplyPayload,
	SetupApplyResult,
	SetupStatus,
	ShotCutsResponse,
	SystemInfo,
	UpdateStatus,
	User,
	UserProject
} from './types';

/**
 * 创建/更新项目的请求体。
 *
 * 字段全部可选，语义是「出现了就更新」：空串表示清空，缺省表示不动。
 * 后端靠键是否存在来区分，所以调用点不要用 falsy 判断去省略字段。
 */
export interface ProjectPayload {
	name?: string;
	code?: string;
	description?: string;
	venue?: string;
	scheduled_start?: string;
	scheduled_end?: string;
	owner_id?: number;
	status?: string;
	mode?: string;
}

/**
 * Same-origin in production. During `vite dev` the admin app runs on its own
 * port, so point this at the Go backend, e.g. `PUBLIC_API_BASE=http://127.0.0.1:3000`
 * in `admin/.env`.
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export const TOKEN_KEY = 'admin_token';

/** Raised for any non-2xx response so callers can show `error.message`. */
export class ApiError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

export function getToken(): string {
	if (!browser) return '';
	return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
	if (!browser) return;
	localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
	if (!browser) return;
	localStorage.removeItem(TOKEN_KEY);
}

interface RequestOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	body?: unknown;
	/** Return the raw response text instead of parsing JSON (CSV downloads). */
	raw?: boolean;
}

/**
 * 这些接口的 4xx/5xx 都不是「会话过期」，不能触发统一登出。
 *
 * 登录与注册本身会返回 401/403；初始化向导在系统还没有任何账号时被调用，
 * 参数错误（400）、已初始化（403）、或初始化模式下的 503 都要原样展示给用户
 * ——之前的实现会把它们当成令牌失效，直接把人踢回登录页，向导页刚填的内容
 * 一整屏就没了。
 */
const NO_SESSION_PATHS = new Set([
	'/api/auth/login',
	'/api/auth/register',
	'/api/setup/status',
	'/api/setup/apply'
]);

/**
 * 会话过期时的统一处理。
 *
 * 后端现在会为未授权返回带可读消息的 JSON 错误体，所以能可靠判定
 * 「令牌无效」而不是网络故障。补上这个分支之前，所有未授权响应都是
 * 400 + 空 body，前端只能弹一个语焉不详的提示并停在半登录状态。
 */
let redirecting = false;
function handleUnauthorized(path: string, status: number): void {
	if (redirecting) return;
	if (NO_SESSION_PATHS.has(path)) return;
	// 403 是当前用户的真实权限状态，不该把登录态踢掉。
	if (status === 403) return;
	redirecting = true;
	clearToken();
	if (browser) {
		void goto(resolve('/login')).finally(() => {
			redirecting = false;
		});
	}
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const { method = 'GET', body, raw = false } = options;

	const headers: Record<string, string> = {};
	if (!raw) headers['Content-Type'] = 'application/json';
	const token = getToken();
	if (token) headers['Authorization'] = `Bearer ${token}`;

	let response: Response;
	try {
		response = await fetch(API_BASE + path, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		throw new ApiError('无法连接到服务器', 0);
	}

	if (raw) {
		if (!response.ok) throw new ApiError(`导出失败 (HTTP ${response.status})`, response.status);
		return (await response.text()) as T;
	}

	// Some handlers return 200/201 with an empty body; tolerate that.
	const text = await response.text();
	let data: unknown = null;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			data = null;
		}
	}

	if (!response.ok) {
		const message =
			data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
				? data.error
				: `请求失败 (HTTP ${response.status})`;
		handleUnauthorized(path, response.status);
		throw new ApiError(message, response.status);
	}

	return data as T;
}

export const api = {
	// --- auth ---
	login: (username: string, password: string) =>
		request<LoginResponse>('/api/auth/login', { method: 'POST', body: { username, password } }),

	/**
	 * 系统是否还没有任何账号。全新部署时用于把登录表单换成
	 * 「创建首个管理员」——此时登录是必然失败的。
	 */
	bootstrapStatus: () => request<{ needs_bootstrap: boolean }>('/api/auth/bootstrap'),

	/**
	 * 创建用户。后端分两种模式：
	 *   - 用户表为空（全新部署）：第一个注册的人自动成为超级管理员，
	 *     请求里的 role 会被忽略，**不需要任何登录态**。
	 *   - 已有用户：必须由管理员及以上登录态发起，且只能授予不高于自己的角色。
	 *
	 * 密码至少 6 位，用户名限 64 字符内的字母数字与 `_.-` 及中文。
	 */
	register: (payload: {
		username: string;
		password: string;
		display_name?: string;
		role?: string;
	}) => request<AuthUser>('/api/auth/register', { method: 'POST', body: payload }),

	profile: () => request<AuthUser>('/api/auth/profile'),

	/**
	 * 修改显示名与邮箱。
	 *
	 * 两个字段都可以传空串表示「清空」，所以不要用 falsy 判断来省略参数——
	 * 后端靠字段是否出现来区分「清空」与「不动」。
	 */
	updateProfile: (payload: { display_name?: string; email?: string }) =>
		request<AuthUser>('/api/auth/profile', { method: 'PUT', body: payload }),

	/**
	 * 修改密码。后端会递增 token_version 让所有旧令牌失效，因此返回新令牌，
	 * 调用方必须立刻换掉本地存的那一份，否则当前设备会被自己踢下线。
	 *
	 * 当前密码错误时后端返回 400（不是 401）：401 会触发本文件的
	 * handleUnauthorized，把用户直接踢回登录页。
	 */
	changePassword: (currentPassword: string, newPassword: string) =>
		request<ChangePasswordResponse>('/api/auth/password', {
			method: 'PUT',
			body: { current_password: currentPassword, new_password: newPassword }
		}),

	// --- setup（全新部署初始化向导） ---
	/**
	 * 系统是否还没初始化，以及向导要用的默认值。
	 *
	 * 公开接口，且后端在初始化模式下也会放行——否则向导页自己都拿不到数据。
	 */
	setupStatus: () => request<SetupStatus>('/api/setup/status'),

	/**
	 * 执行初始化：写 .env → 跑迁移 → 建管理员。
	 *
	 * 只在系统未初始化时可用，重复调用返回 403。
	 */
	setupApply: (payload: SetupApplyPayload) =>
		request<SetupApplyResult>('/api/setup/apply', { method: 'POST', body: payload }),

	// --- status & health ---
	status: () => request<ServerStatus>('/api/status'),

	/**
	 * 健康检查。公开接口，数据库不可用时返回 503，因此不能复用 request()
	 * ——那会把「服务不健康」当成请求失败抛掉，这里要的是响应体本身。
	 */
	health: async (): Promise<HealthStatus> => {
		const res = await fetch(`${API_BASE}/api/health`, {
			headers: { Accept: 'application/json' }
		});
		return (await res.json()) as HealthStatus;
	},

	// --- roles ---
	/** 角色清单（含中文名与等级），任意登录用户可读。 */
	roles: () => request<RoleInfo[]>('/api/roles'),

	// --- system（仅超级管理员） ---
	systemInfo: () => request<SystemInfo>('/api/system/info'),

	updateStatus: () => request<UpdateStatus>('/api/system/update'),

	/**
	 * 应用更新。
	 *
	 * target_version 必须传用户确认过的那个版本号，后端会与更新源上的当前
	 * 版本比对，不一致就拒绝——否则会出现「界面确认的是 1.2.0，实际装上
	 * 1.3.0」。
	 */
	applyUpdate: (targetVersion: string) =>
		request<ApplyUpdateResult>('/api/system/update/apply', {
			method: 'POST',
			body: { confirm: true, target_version: targetVersion }
		}),

	// --- users ---
	listUsers: () => request<User[]>('/api/admin/users'),

	deleteUser: (id: number) =>
		request<{ message: string }>(`/api/admin/users/${id}`, { method: 'DELETE' }),

	updateUserRole: (id: number, role: string) =>
		request<{ message: string }>(`/api/admin/users/${id}/role`, { method: 'PUT', body: { role } }),

	// --- projects ---
	listProjects: () => request<Project[]>('/api/admin/projects'),

	createProject: (payload: ProjectPayload) =>
		request<Project>('/api/admin/projects', { method: 'POST', body: payload }),

	/**
	 * 更新项目。
	 *
	 * **字段只有出现才会被更新**，空串表示「清空」而不是「不动」。
	 * 后端此前写的是 `if description != ""`，传空串会被静默忽略，描述一旦
	 * 设过就再也清不掉；现在改用「键是否存在」判断，所以这里的 payload
	 * 不能再用 falsy 判断去省略字段。
	 */
	updateProject: (id: number, payload: ProjectPayload) =>
		request<{ message: string }>(`/api/admin/projects/${id}`, { method: 'PUT', body: payload }),

	deleteProject: (id: number) =>
		request<{ message: string }>(`/api/admin/projects/${id}`, { method: 'DELETE' }),

	// --- 机位预设（B3：不再硬编码在导播端） ---
	cameras: (projectId: number) => request<ProjectCamera[]>(`/api/projects/${projectId}/cameras`),

	createCamera: (projectId: number, payload: { name: string; sort_order?: number }) =>
		request<ProjectCamera>(`/api/admin/projects/${projectId}/cameras`, {
			method: 'POST',
			body: payload
		}),

	updateCamera: (
		projectId: number,
		cameraId: number,
		payload: { name?: string; sort_order?: number }
	) =>
		request<{ message: string }>(`/api/admin/projects/${projectId}/cameras/${cameraId}`, {
			method: 'PUT',
			body: payload
		}),

	deleteCamera: (projectId: number, cameraId: number) =>
		request<{ message: string }>(`/api/admin/projects/${projectId}/cameras/${cameraId}`, {
			method: 'DELETE'
		}),

	// --- 切台报表（B1） ---
	shotCuts: (projectId: number, params: { from?: string; to?: string; limit?: number } = {}) => {
		const query = new URLSearchParams();
		if (params.from) query.set('from', params.from);
		if (params.to) query.set('to', params.to);
		if (params.limit) query.set('limit', String(params.limit));
		const suffix = query.toString();
		return request<ShotCutsResponse>(
			`/api/projects/${projectId}/shot-cuts${suffix ? `?${suffix}` : ''}`
		);
	},

	// --- user/project assignment ---
	listUserProjects: (userId: number) =>
		request<UserProject[]>(`/api/admin/users/${userId}/projects`),

	assign: (userId: number, projectId: number) =>
		request<UserProject>('/api/admin/assign', {
			method: 'POST',
			body: { user_id: userId, project_id: projectId }
		}),

	revoke: (userId: number, projectId: number) =>
		request<{ message: string }>('/api/admin/revoke', {
			method: 'POST',
			body: { user_id: userId, project_id: projectId }
		}),

	// --- logs ---
	/**
	 * 协调日志。
	 *
	 * total 是真实总行数，不是本页长度。翻页用 cursor（上一页的 next_cursor），
	 * 不要用 offset：日志表持续写入，offset 会让同一条被重复看到或整段跳过。
	 */
	listLogs: (
		params: {
			projectId?: string;
			type?: string;
			senderId?: string;
			from?: string;
			to?: string;
			limit?: number;
			cursor?: number;
		} = {}
	) => {
		const query = new URLSearchParams();
		if (params.projectId) query.set('project_id', params.projectId);
		if (params.type) query.set('type', params.type);
		if (params.senderId) query.set('sender_id', params.senderId);
		if (params.from) query.set('from', params.from);
		if (params.to) query.set('to', params.to);
		if (params.cursor) query.set('cursor', String(params.cursor));
		query.set('limit', String(params.limit ?? 100));
		return request<LogsResponse>(`/api/logs?${query.toString()}`);
	},

	listMessages: (projectId: number, limit = 50) =>
		request<Message[]>(`/api/messages/${projectId}?limit=${limit}`),

	/**
	 * 导出为 JSON 报告。
	 *
	 * from/to 是**必填**的：后端此前对整个项目历史做无条件 Find，既没有时间
	 * 边界也没有行数上限，一次误点就可能把几百 MB 灌进内存。
	 */
	exportLogs: (projectId: number, from: string, to: string) =>
		request<ExportResult>('/api/logs/export', {
			method: 'POST',
			body: { project_id: projectId, from, to }
		}),

	exportLogsCsv: (projectId: number, from: string, to: string) =>
		request<string>('/api/logs/export/csv', {
			method: 'POST',
			body: { project_id: projectId, from, to },
			raw: true
		}),

	cleanupLogs: (days: number) =>
		request<CleanupResult>('/api/logs/cleanup', { method: 'POST', body: { days } }),

	// --- 操作审计（B4） ---
	/**
	 * 操作审计记录。
	 *
	 * 与 listLogs 是两回事：listLogs 读的是 messages 表（谁切了台、谁发了
	 * 内部消息），这里读的是 audit_logs（谁改了别人的角色、谁清掉了日志）。
	 * 这个页面以前叫「日志审计」，显示的其实是前者。
	 */
	auditLogs: (
		params: {
			action?: string;
			actorId?: string;
			from?: string;
			to?: string;
			limit?: number;
			cursor?: number;
		} = {}
	) => {
		const query = new URLSearchParams();
		if (params.action) query.set('action', params.action);
		if (params.actorId) query.set('actor_id', params.actorId);
		if (params.from) query.set('from', params.from);
		if (params.to) query.set('to', params.to);
		if (params.cursor) query.set('cursor', String(params.cursor));
		query.set('limit', String(params.limit ?? 100));
		return request<AuditLogsResponse>(`/api/admin/audit-logs?${query.toString()}`);
	},

	// --- plugins ---
	listPlugins: () => request<PluginInfo[]>('/api/plugins'),

	projectStats: (projectId: number) => request<ProjectStats>(`/api/projects/${projectId}/stats`)
};
