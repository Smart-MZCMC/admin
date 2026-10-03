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
	AuditLogsResponse,
	AuthUser,
	ChangePasswordResponse,
	CleanupResult,
	ExportResult,
	HealthStatus,
	LoginResponse,
	LogsResponse,
	Message,
	PermissionsResponse,
	PluginInfo,
	PolicyView,
	Project,
	ProjectCamera,
	ProjectStats,
	RoleInfo,
	RolePermissionsResult,
	ServerStatus,
	SetupApplyPayload,
	SetupApplyResult,
	SetupStatus,
	ShotCutsResponse,
	SystemInfo,
	SystemMetrics,
	UpdateProgress,
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
	/**
	 * 响应体里的 `code`，没有就是空串。
	 *
	 * 少数接口用它决定界面怎么处置，HTTP 状态码表达不了这个差别——权限编辑
	 * 接口的 policy_conflict（409，本次已回滚）与 unknown_role（400，刷新就好）
	 * 都只是「没保存」，但一个要保留草稿、一个要丢掉。编码进 message 的话
	 * 调用点就得去匹配中文句子，而中文句子一改就静默失配。
	 */
	readonly code: string;
	constructor(message: string, status: number, code = '') {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
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
	'/api/auth/admin-login',
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

/**
 * 会话失效时的回调，由 auth store 注册。
 *
 * 用注册而不是直接 import store：client 是 store 的依赖，反向 import 会成环，
 * 而且这种环在模块初始化顺序不对时表现成 undefined，很难查。
 */
let sessionLostHandler: (() => void) | null = null;

export function onSessionLost(handler: () => void): () => void {
	sessionLostHandler = handler;
	return () => {
		if (sessionLostHandler === handler) sessionLostHandler = null;
	};
}

function handleUnauthorized(path: string, status: number): void {
	if (redirecting) return;
	if (NO_SESSION_PATHS.has(path)) return;
	// 403 是当前用户的真实权限状态，不该把登录态踢掉。
	if (status === 403) return;
	redirecting = true;
	clearToken();
	// 令牌没了，权限必须跟着没。否则界面上留着旧权限、而每个请求都是 401，
	// 用户看到的是「按钮全在、点了全报错」，还会以为系统出了 bug。
	sessionLostHandler?.();
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
		const body =
			data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null;
		const message =
			body && typeof body.error === 'string' ? body.error : `请求失败 (HTTP ${response.status})`;
		const code = body && typeof body.code === 'string' ? body.code : '';
		handleUnauthorized(path, response.status);
		throw new ApiError(message, response.status, code);
	}

	return data as T;
}

export const api = {
	// --- auth ---
	/**
	 * 管理后台网页的登录入口。
	 *
	 * 走 /api/auth/admin-login 而不是 /api/auth/login：后者是给原生客户端
	 * （导播端/采访端/解说端）用的，不该按网页后台的门槛拦——导播账号本来就
	 * 该能登录，它用的是原生界面。admin-login 会在口令校验通过之后额外要求
	 * 角色达到后端的 authz.admin_min_role，不够则返回 403 并说明原因。
	 *
	 * 于是「导播能不能进后台」这条策略只由后端一处决定，前端不自己写一份
	 * 角色门槛表（那种表加角色时必然漏改）。
	 */
	adminLogin: (username: string, password: string) =>
		request<LoginResponse>('/api/auth/admin-login', {
			method: 'POST',
			body: { username, password }
		}),

	/** 保留给仍需通用登录的调用点（例如诊断脚本）。网页界面一律用 adminLogin。 */
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
	 * 当前账号的生效权限清单。
	 *
	 * 门槛是「登录即可」：它只回答「我自己能干什么」，不返回全量策略矩阵。
	 * 界面要按权限名渲染按钮就必须问后端这句，因为角色名与权限名之间没有
	 * 任何映射关系（负责人拿得到 user.view，角色却不是 admin）。
	 */
	permissions: () => request<PermissionsResponse>('/api/auth/permissions'),

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

	// --- rbac（在线权限编辑，后端守卫 system.maintain） ---
	/**
	 * 当前生效的权限矩阵。
	 *
	 * 与 permissions() 完全是两回事：那条只回答「我自己能干什么」，任何登录
	 * 用户都能问；这条返回全量策略（谁有什么权限），只给能改策略的人看。
	 * 别拿 permissions() 的响应去填这张矩阵——那会让页面显示成「只有我的角色
	 * 有权限」，而其余行全空。
	 *
	 * holders 与 grants 都是后端从**生效中**的策略现算的，与库里那一行不一致
	 * 时以现算的为准：界面照着库里那份显示会让人以为某项权限没生效（于是反复
	 * 勾选），而真相是它生效了、只是被脏行挡住。
	 */
	policy: () => request<PolicyView>('/api/rbac/policy'),

	/**
	 * 把某个角色的权限集合**整体替换**成 permissions 里的那一组。
	 *
	 * 语义是「改成这样」而不是「追加」：没出现在列表里的权限一律变成不授予。
	 * 界面渲染的是一整张勾选表，提交的就是全量。
	 *
	 * ⚠️ 传空数组是一次**合法**操作（把该角色的权限全部收走），不要当成
	 * 「没什么可改的」而跳过请求——后端靠列表本身区分「清空」与「没这个字段」。
	 *
	 * 失败时响应的 `code` 由 ApiError.code 带出来（protected / unknown_role /
	 * unknown_permission / policy_conflict / policy_unavailable），见
	 * $lib/rbac-matrix 的 policyFailure。
	 */
	setRolePermissions: (role: string, permissions: string[]) =>
		request<RolePermissionsResult>(`/api/rbac/roles/${encodeURIComponent(role)}/permissions`, {
			method: 'PUT',
			body: { permissions }
		}),

	// --- system（仅超级管理员） ---
	systemInfo: () => request<SystemInfo>('/api/system/info'),

	/**
	 * 运行指标：内存 / 磁盘 / 组件健康。
	 *
	 * 与 systemInfo 分开是因为轮询频率差一个数量级：监控页每 10 秒取一次，
	 * 而运行环境一次进来看一眼就够，混在一个接口里会把 exe 路径、工作目录、
	 * 更新器配置这些不会变的字段每 10 秒传一次。
	 *
	 * 后端刻意做成永不失败（探活失败也返回 200，只把状态标成 error），
	 * 所以这里不需要额外的错误分支——真出故障时页面照样有内容可显示。
	 */
	systemMetrics: () => request<SystemMetrics>('/api/system/metrics'),

	updateStatus: () => request<UpdateStatus>('/api/system/update'),

	/**
	 * 应用更新。
	 *
	 * target_version 必须传用户确认过的那个版本号，后端会与更新源上的当前
	 * 版本比对，不一致就拒绝——否则会出现「界面确认的是 1.2.0，实际装上
	 * 1.3.0」。
	 *
	 * 后端**立刻返回**（原先是同步做完一整轮）：下载 26 MB 要好几分钟，
	 * 放在一个请求里既看不到进度、也随时可能被反向代理掐断。真正的结果
	 * 通过 updateProgress 轮询获得。
	 */
	applyUpdate: (targetVersion: string) =>
		request<{ started: boolean; message?: string }>('/api/system/update/apply', {
			method: 'POST',
			body: { confirm: true, target_version: targetVersion }
		}),

	/** 查询更新进度。stage=idle 表示当前没有任务在跑。 */
	updateProgress: () => request<UpdateProgress>('/api/system/update/progress'),

	// --- users ---
	listUsers: () => request<User[]>('/api/admin/users'),

	deleteUser: (id: number) =>
		request<{ message: string }>(`/api/admin/users/${id}`, { method: 'DELETE' }),

	updateUserRole: (id: number, role: string) =>
		request<{ message: string }>(`/api/admin/users/${id}/role`, { method: 'PUT', body: { role } }),

	// --- projects ---
	/**
	 * 全量项目列表（管理端），后端挂的是 project.manage。
	 *
	 * 只给 /projects 那个增删改页面用——它需要不过滤的完整数据。
	 * 任何登录用户都能看的页面（总览、日志筛选、成员授权、顶部搜索）都用
	 * 下面的 myProjects()。
	 */
	listProjects: () => request<Project[]>('/api/admin/projects'),

	/**
	 * 「我能看到哪些项目」，登录即可（GET /api/projects）。
	 *
	 * 后端在这里按 user_projects 收窄：管理员及以上拿全部，其余角色只拿被授权
	 * 的那些（一个人一个都没授权时退回全部，否则刚接上鉴权的存量部署会看到
	 * 空列表）。
	 *
	 * ⚠️ 别用 listProjects() 代替它做只读展示：那条挂在 project.manage 后面，
	 * 负责人没有它，于是总览页、日志页的导出、成员授权页会各自弹一次「加载
	 * 失败」——权限迁移后负责人第一次登录后台就会看到一屏报错。
	 */
	myProjects: () => request<Project[]>('/api/projects'),

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
