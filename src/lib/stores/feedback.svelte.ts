/** Lightweight one-at-a-time notification queue rendered by <ToastHost />. */

export type FeedbackType = 'info' | 'success' | 'warning' | 'error';

export interface FeedbackItem {
	id: number;
	message: string;
	type: FeedbackType;
}

function createFeedbackStore() {
	let items = $state<FeedbackItem[]>([]);
	let nextId = 1;

	function push(message: string, type: FeedbackType = 'info'): number {
		const id = nextId++;
		items.push({ id, message, type });
		return id;
	}

	function dismiss(id: number): void {
		items = items.filter((item) => item.id !== id);
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
