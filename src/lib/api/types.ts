/** Shared API types, mirroring backend/app/models and the JSON the controllers emit. */

export type Role = 'admin' | 'director';

export interface AuthUser {
	id: number;
	username: string;
	display_name: string;
	role: Role;
}

export interface LoginResponse {
	token: string;
	user: AuthUser;
}

/** backend/app/models/user.go */
export interface User {
	id: number;
	username: string;
	display_name: string;
	role: Role;
	created_at?: string;
}

/** backend/app/models/project.go */
export interface Project {
	id: number;
	name: string;
	code: string;
	description: string;
	created_at?: string;
}

/** backend/app/models/user_project.go */
export interface UserProject {
	id: number;
	user_id: number;
	project_id: number;
}

/** backend/app/models/message.go */
export interface Message {
	id: number;
	project_id: number;
	sender_id: number;
	type: string;
	content: string;
	created_at: string;
	sender?: User;
}

/** GET /api/logs */
export interface LogsResponse {
	total: number;
	messages: Message[];
}

/** GET /api/status */
export interface ServerStatus {
	status: string;
	online_count: number;
	version: string;
}

/** GET /api/plugins — plugins.List() returns name/version pairs. */
export interface PluginInfo {
	name: string;
	version: string;
}

/** GET /api/projects/:projectId/stats */
export interface ProjectStats {
	project_id: number;
	message_count: number;
	lock_active: boolean;
	lock_holder: number;
	interview_points: number;
	timestamp: string;
}

/** POST /api/logs/export and /api/logs/export/csv both report a row count back. */
export interface ExportResult {
	count: number;
	message?: string;
}

/** POST /api/logs/cleanup */
export interface CleanupResult {
	message: string;
	count: number;
}
