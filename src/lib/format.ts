/**
 * Message payload rendering helpers.
 *
 * `Message.content` holds the raw JSON payload the client sent, so the shape
 * depends on `Message.type`. These helpers turn the common ones into
 * something readable; anything unrecognised falls back to the raw string.
 */

/** 切台状态载荷：导播端每次切台都同时给出「当前播送」和「即将切台」。 */
export interface ShotStatePayload {
	current: string;
	next: string;
}

function parsePayload(content: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(content);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

function asText(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/**
 * 返回一行人类可读的消息摘要。
 *
 * 旧的 `next_shot` / `confirm_switch` 也一并处理，历史日志不会因为
 * 协议升级而变成一坨 JSON。
 */
export function formatMessage(type: string, content: string): string {
	const payload = parsePayload(content);
	if (!payload) return content || '—';

	switch (type) {
		case 'shot_state': {
			const current = asText(payload.current);
			const next = asText(payload.next);
			if (current && next) return `当前播送: ${current} → 即将切台: ${next}`;
			if (next) return `即将切台: ${next}`;
			return `正在播送: ${current || '—'}`;
		}
		// 历史类型：载荷只有 content 字段。
		case 'next_shot':
			return `即将切台: ${asText(payload.content)}`;
		case 'confirm_switch':
			return `正在播送: ${asText(payload.content)}`;
		case 'chat':
			return asText(payload.message) || '—';
		case 'interview_status':
			return `${asText(payload.point_name) || asText(payload.point_code)}: ${asText(payload.status)}`;
		case 'lock_update':
			return asText(payload.action) || '—';
		default:
			return content || '—';
	}
}

/** 从 raw content 里取出切台状态，用于表格里加标签。 */
export function readShotState(content: string): ShotStatePayload | null {
	const payload = parsePayload(content);
	if (!payload) return null;
	return { current: asText(payload.current), next: asText(payload.next) };
}
