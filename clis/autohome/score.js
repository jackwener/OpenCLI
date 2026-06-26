/**
 * autohome score — 口碑 (owner-rating) summary for a car series.
 *
 * Reads `__NEXT_DATA__.props.pageProps.baseData` (+ `qualityData`) from the
 * koubei page `k.autohome.com.cn/<seriesId>`: overall rating, per-dimension
 * scores, level, guide price, the reliability PPH (每百辆车故障数), and the
 * competitor comparison. All unsigned, login-free. Returns a key/value sheet.
 *
 * Note: Autohome's per-review TEXT list loads from a separate signed XHR and
 * is intentionally not scraped — this command surfaces the aggregate only.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    AH_KOUBEI_BASE,
    SCORE_COLUMNS,
    CommandExecutionError,
    EmptyResultError,
    assertPlainObject,
    ahFetch,
    clean,
    extractPageProps,
    normalizeSeriesId,
} from './utils.js';

/** Number or null. */
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Pure parser: koubei pageProps → field/value rows. Exported for unit tests.
 */
export function parseScore(pp, seriesId) {
    const bd = assertPlainObject(pp?.baseData, 'autohome baseData');
    const qd = (pp && pp.qualityData) || {};

    const competitors = (Array.isArray(bd.cmpSeriesScore) ? bd.cmpSeriesScore : [])
        .map((c) => {
            const name = clean(c.seriesname || c.seriesName);
            const s = c.average || c.score;
            return name ? `${name}(${s})` : '';
        })
        .filter(Boolean)
        .slice(0, 4)
        .join(', ');

    const fields = [
        ['series_id', String(seriesId)],
        ['name', clean(bd.seriesname)],
        ['brand', clean(bd.brandName)],
        ['level', clean(bd.levelname)],
        ['guide_price', bd.pricerange ? `${clean(bd.pricerange)}万` : ''],
        ['overall', num(bd.average ?? bd.seriesAverage)],
    ];

    for (const axis of (Array.isArray(bd.seriesScoreList) ? bd.seriesScoreList : [])) {
        const label = clean(axis.typeName);
        if (label) fields.push([label, num(axis.score)]);
    }

    fields.push(['pph_每百车故障', num(qd.pph)]);
    fields.push(['review_users', num(qd.userCount)]);
    fields.push(['competitors', competitors]);
    fields.push(['url', `${AH_KOUBEI_BASE}/${seriesId}`]);

    return fields.map(([field, value]) => ({ field, value }));
}

cli({
    site: 'autohome',
    name: 'score',
    access: 'read',
    aliases: ['koubei', 'rating'],
    description: '汽车之家车系口碑评分（总分 + 各维度 + 故障率PPH + 竞品对比，免登录）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'series_id', required: true, positional: true, help: '车系 ID（来自 brand 的 series_id，或 k.autohome.com.cn/<id> URL）' },
    ],
    columns: SCORE_COLUMNS,
    func: async (args) => {
        const seriesId = normalizeSeriesId(args.series_id);
        const html = await ahFetch(`${AH_KOUBEI_BASE}/${seriesId}`, `score ${seriesId}`);
        const pp = extractPageProps(html);
        if (!pp) {
            throw new CommandExecutionError(
                `autohome score ${seriesId}`,
                'No koubei data found — the series id may be wrong, or Autohome changed its page.',
            );
        }
        const rows = parseScore(pp, seriesId);
        const map = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        if (!map.name && map.overall == null) {
            throw new EmptyResultError(
                `autohome score ${seriesId}`,
                'This series has no koubei rating yet.',
            );
        }
        return rows;
    },
});
