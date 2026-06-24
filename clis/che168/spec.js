/**
 * che168 spec — full parameter/config sheet for a car trim (款型) by specid.
 *
 * Reads the open, login-free cache API
 * `https://cacheapigo.che168.com/CarProduct/GetParam.ashx?specid=<id>`, which
 * returns GBK JSON of grouped `{name, value}` parameters (基本参数 / 车身 /
 * 发动机 / 变速箱 / 底盘转向 / 车轮制动 …). Parsing is a pure JSON→rows
 * function so it is unit-tested against a frozen fixture (no network).
 *
 * specid is the autohome/che168 trim id — the same namespace surfaced by
 * `autohome brand` series pages and any `.../spec/<id>/` URL.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CommandExecutionError,
    EmptyResultError,
    PARAM_API,
    SPEC_COLUMNS,
    che168GetJson,
    clean,
    normalizeSpecId,
} from './utils.js';

/**
 * Pure parser: GetParam JSON → grouped field/value rows. Exported for testing.
 */
export function parseParams(json) {
    const result = json && json.result;
    const groups = result && Array.isArray(result.paramtypeitems) ? result.paramtypeitems : [];
    const rows = [];
    for (const g of groups) {
        const group = clean(g && g.name);
        const items = g && Array.isArray(g.paramitems) ? g.paramitems : [];
        for (const it of items) {
            const field = clean(it && it.name);
            if (!field) continue;
            rows.push({ group, field, value: clean(it && it.value) });
        }
    }
    return rows;
}

cli({
    site: 'che168',
    name: 'spec',
    access: 'read',
    aliases: ['param', 'config'],
    description: '汽车之家/车168 车型完整参数配置（基本/车身/发动机/变速箱/底盘/制动，免登录）',
    domain: 'cacheapigo.che168.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'specid', required: true, positional: true, help: '车型款型 ID（specid，来自 autohome/che168 的 /spec/<id>/ URL 或 specid= 参数）' },
    ],
    columns: SPEC_COLUMNS,
    func: async (args) => {
        const specid = normalizeSpecId(args.specid);
        const json = await che168GetJson(`${PARAM_API}?specid=${specid}`, `spec ${specid}`);
        if (json && Number(json.returncode) !== 0) {
            throw new CommandExecutionError(`che168 spec ${specid} API returncode ${json.returncode}: ${clean(json.message)}`);
        }
        const rows = parseParams(json);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `che168 spec ${specid}`,
                'No spec parameters found — the specid may be wrong or the trim discontinued.',
            );
        }
        return rows;
    },
});
