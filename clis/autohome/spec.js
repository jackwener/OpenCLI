/**
 * autohome spec — full parameter/config sheet for a car trim (款型) by specid.
 *
 * Autohome's own config page obfuscates values behind a rotating CSS font-glyph
 * map and signs its JSON API, so it can't be read from plain HTTP. The SAME
 * 汽车之家 group, however, serves the identical spec data UNSIGNED through its
 * 车168 sister-site cache API
 * (`cacheapigo.che168.com/CarProduct/GetParam.ashx?specid=<id>`, GBK JSON of
 * grouped `{name, value}` params: 基本参数 / 车身 / 发动机 / 变速箱 /
 * 底盘转向 / 车轮制动 …). `spec` reads that — no login, no browser.
 *
 * specid is the 汽车之家 trim id — the same namespace surfaced by any
 * `.../spec/<id>/` URL or `?specid=<id>` query.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CommandExecutionError,
    EmptyResultError,
    PARAM_API,
    SPEC_COLUMNS,
    clean,
    normalizeSpecId,
    paramGetJson,
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
    site: 'autohome',
    name: 'spec',
    access: 'read',
    aliases: ['param', 'config'],
    description: '汽车之家车型完整参数配置（基本/车身/发动机/变速箱/底盘/制动，免登录）',
    domain: 'cacheapigo.che168.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'specid', required: true, positional: true, help: '车型款型 ID（specid，来自汽车之家 /spec/<id>/ URL 或 specid= 参数）' },
    ],
    columns: SPEC_COLUMNS,
    func: async (args) => {
        const specid = normalizeSpecId(args.specid);
        const json = await paramGetJson(`${PARAM_API}?specid=${specid}`, `autohome spec ${specid}`);
        if (json && Number(json.returncode) !== 0) {
            throw new CommandExecutionError(`autohome spec ${specid} API returncode ${json.returncode}: ${clean(json.message)}`);
        }
        const rows = parseParams(json);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `autohome spec ${specid}`,
                'No spec parameters found — the specid may be wrong or the trim discontinued.',
            );
        }
        return rows;
    },
});
