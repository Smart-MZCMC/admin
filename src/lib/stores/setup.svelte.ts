/**
 * 初始化状态。
 *
 * 后端在数据库不存在时会进入「初始化模式」：除 /api/setup/* 以外的接口一律
 * 返回 503。这里记住这个状态，让布局能在任何页面把用户送到向导页，
 * 而不是让人对着一屏「请求失败」发呆。
 */
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { api } from '$lib/api/client';
import type { SetupStatus } from '$lib/api/types';

function createSetupStore() {
	let status = $state<SetupStatus | null>(null);
	let loading = $state(true);
	let checked = false;

	/**
	 * 查询初始化状态。同一个页面里只会真正请求一次，除非传 force。
	 *
	 * 请求失败时 status 保持 null：这可能是 vite dev 下没连上后端，
	 * 也可能是旧版后端没有这个接口。两种情况下都不该把人锁在向导页，
	 * 所以调用方要把 null 当成「不是初始化模式」处理。
	 */
	async function check(force = false): Promise<SetupStatus | null> {
		if (checked && !force) return status;
		loading = true;
		try {
			status = await api.setupStatus();
		} catch {
			status = null;
		} finally {
			checked = true;
			loading = false;
		}
		return status;
	}

	/** 把它记成「已初始化」，避免向导完成后布局还往回跳。 */
	function markDone(): void {
		if (status) status = { ...status, needs_setup: false };
	}

	/** 未初始化时把用户送到向导页；已经在向导页就什么都不做。 */
	function guard(pathname: string): void {
		if (!browser || status?.needs_setup !== true) return;
		const target = resolve('/setup');
		if (pathname.replace(/\/+$/, '') === target) return;
		void goto(target, { replaceState: true });
	}

	return {
		get status() {
			return status;
		},
		get loading() {
			return loading;
		},
		/** null（还没查到/查不到）一律当 false，不拦人。 */
		get needsSetup() {
			return status?.needs_setup === true;
		},
		check,
		markDone,
		guard
	};
}

export const setup = createSetupStore();
