import { describe, expect, it } from 'vitest';
import { checkVersion } from './version';

/**
 * 端到端对照矩阵：用真实服务端返回的字段组合，逐格核对界面会显示什么。
 *
 * 这一组是给「最低适配版本」这个语义兜底的 —— 它决定了横幅是否出现、
 * 出现时提示该升哪一边、还是用红色（必须更新）还是琥珀色（只是建议）。
 */
describe('版本判定矩阵（服务端 version=1.2.0 / min_client_version=1.2.0）', () => {
	const SERVER = '1.2.0';
	const MIN = '1.2.0';

	const cases: [string, string, string, string, string][] = [
		// 客户端版本, 服务端, 最低适配, 期望状态, 期望是否提示
		['1.2.0', SERVER, MIN, 'match', '否'],
		['1.1.0', SERVER, MIN, 'unsupported', '是（红）'],
		['1.0.0', SERVER, MIN, 'unsupported', '是（红）'],
		['1.3.0', SERVER, MIN, 'client-ahead', '是（琥珀）'],
		['1.2.1', SERVER, MIN, 'client-ahead', '是（琥珀）'],
		// 老服务端没有 min_client_version
		['1.1.0', SERVER, '', 'client-behind', '是（琥珀）'],
		['1.1.0', SERVER, 'dev', 'client-behind', '是（琥珀）'],
		// 开发构建：没有注入版本号
		['dev', SERVER, MIN, 'unknown', '否'],
		['', SERVER, MIN, 'unknown', '否'],
		['1.2.0', '', MIN, 'unknown', '否']
	];

	for (const [client, server, min, expected] of cases) {
		it(`${client || '(空)'} vs ${server || '(空)'}（最低 ${min || '未声明'}）→ ${expected}`, () => {
			expect(checkVersion(client, server, min).status).toBe(expected);
		});
	}

	/** 服务端把最低适配版本上调后，之前只是「建议」的客户端会变成「必须更新」。 */
	it('上调最低适配版本会改变判定', () => {
		expect(checkVersion('1.2.0', '1.3.0', '1.2.0').status).toBe('client-behind');
		expect(checkVersion('1.2.0', '1.3.0', '1.2.5').status).toBe('unsupported');
	});

	/** 后端修 bug 发新版（只抬 Version、不抬 MinClientVersion）时不该惊动客户端。 */
	it('仅抬高服务端版本、不抬高最低适配时只降为「建议」', () => {
		const r = checkVersion('1.2.0', '1.9.9', '1.2.0');
		expect(r.status).toBe('client-behind');
		expect(r.isUrgent).toBe(false);
	});
});
