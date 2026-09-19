/**
 * Thin fetch wrapper over the Go backend's REST API.
 *
 * The admin app is served by the same Go binary that serves the API, so a
 * same-origin base is correct in production. During `vite dev` the app runs on
 * a different port, so set `PUBLIC_API_BASE` (e.g. http://127.0.0.1:3000) to
 * point at the backend.
 */
import { browser } from '$app/environment';
import type {
	AuthUser,
	CleanupResult,
	ExportResult,
	LoginResponse,
	LogsResponse,
	Message,
	PluginInfo,
	Project,
	ProjectStats,
	ServerStatus,
	User,
	UserProject
} from './types';

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
		throw new ApiError(message, response.status);
	}

	return data as T;
}

export const api = {
	// --- auth ---
	login: (username: string, password: string) =>
		request<LoginResponse>('/api/auth/login', { method: 'POST', body: { username, password } }),

	register: (payload: {
		username: string;
		password: string;
		display_name?: string;
		role?: string;
	}) => request<AuthUser>('/api/auth/register', { method: 'POST', body: payload }),

	profile: () => request<AuthUser>('/api/auth/profile'),

	// --- status ---
	status: () => request<ServerStatus>('/api/status'),

	// --- users ---
	listUsers: () => request<User[]>('/api/admin/users'),

	deleteUser: (id: number) => request<{ message: string }>(`/api/admin/users/${id}`, { method: 'DELETE' }),

	updateUserRole: (id: number, role: string) =>
		request<{ message: string }>(`/api/admin/users/${id}/role`, { method: 'PUT', body: { role } }),

	// --- projects ---
	listProjects: () => request<Project[]>('/api/admin/projects'),

	createProject: (payload: { name: string; code: string; description?: string }) =>
		request<Project>('/api/admin/projects', { method: 'POST', body: payload }),

	updateProject: (id: number, payload: { name?: string; description?: string }) =>
		request<{ message: string }>(`/api/admin/projects/${id}`, { method: 'PUT', body: payload }),

	deleteProject: (id: number) =>
		request<{ message: string }>(`/api/admin/projects/${id}`, { method: 'DELETE' }),

	// --- user/project assignment ---
	listUserProjects: (userId: number) => request<UserProject[]>(`/api/admin/users/${userId}/projects`),

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
	listLogs: (params: { projectId?: string; type?: string; limit?: number } = {}) => {
		const query = new URLSearchParams();
		if (params.projectId) query.set('project_id', params.projectId);
		if (params.type) query.set('type', params.type);
		query.set('limit', String(params.limit ?? 100));
		return request<LogsResponse>(`/api/logs?${query.toString()}`);
	},

	listMessages: (projectId: number, limit = 50) =>
		request<Message[]>(`/api/messages/${projectId}?limit=${limit}`),

	exportLogs: (projectId: number) =>
		request<ExportResult>('/api/logs/export', { method: 'POST', body: { project_id: projectId } }),

	exportLogsCsv: (projectId: number) =>
		request<string>('/api/logs/export/csv', { method: 'POST', body: { project_id: projectId }, raw: true }),

	cleanupLogs: (days: number) =>
		request<CleanupResult>('/api/logs/cleanup', { method: 'POST', body: { days } }),

	// --- plugins ---
	listPlugins: () => request<PluginInfo[]>('/api/plugins'),

	projectStats: (projectId: number) => request<ProjectStats>(`/api/projects/${projectId}/stats`)
};
