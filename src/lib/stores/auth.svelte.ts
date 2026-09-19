/**
 * Authentication state. The JWT lives in localStorage so the session survives a
 * reload, exactly like the original single-file admin page did.
 */
import { browser } from '$app/environment';
import { api, clearToken, getToken, setToken } from '$lib/api/client';
import type { AuthUser } from '$lib/api/types';

interface AuthState {
	user: AuthUser | null;
	/** True until the stored token has been checked against /api/auth/profile. */
	loading: boolean;
}

function createAuthStore() {
	let user = $state<AuthUser | null>(null);
	let loading = $state(true);
	let restoring: Promise<void> | null = null;

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
				user = await api.profile();
			} catch {
				clearToken();
				user = null;
			} finally {
				loading = false;
			}
		})();
		return restoring;
	}

	async function login(username: string, password: string): Promise<AuthUser> {
		const result = await api.login(username, password);
		setToken(result.token);
		user = result.user;
		loading = false;
		return result.user;
	}

	function logout(): void {
		clearToken();
		user = null;
	}

	return {
		get user() {
			return user;
		},
		get loading() {
			return loading;
		},
		get isAdmin() {
			return user?.role === 'admin';
		},
		restore,
		login,
		logout
	};
}

export const auth = createAuthStore();
