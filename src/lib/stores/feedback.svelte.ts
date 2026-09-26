/** Lightweight notification queue rendered by <ToastHost />. */

export type FeedbackType = 'info' | 'success' | 'warning' | 'error';

export interface FeedbackItem {
	id: number;
	message: string;
	type: FeedbackType;
}

/** Errors stay a little longer so they can actually be read. */
const DURATION: Record<FeedbackType, number> = {
	info: 3000,
	success: 3000,
	warning: 5000,
	error: 6000
};

function createFeedbackStore() {
	let items = $state<FeedbackItem[]>([]);
	let nextId = 1;

	function dismiss(id: number): void {
		items = items.filter((item) => item.id !== id);
	}

	function push(message: string, type: FeedbackType = 'info'): number {
		const id = nextId++;
		items.push({ id, message, type });
		setTimeout(() => dismiss(id), DURATION[type]);
		return id;
	}

	return {
		get items() {
			return items;
		},
		push,
		dismiss,
		success: (message: string) => push(message, 'success'),
		error: (message: string) => push(message, 'error'),
		warning: (message: string) => push(message, 'warning'),
		info: (message: string) => push(message, 'info')
	};
}

export const feedback = createFeedbackStore();
