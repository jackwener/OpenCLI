/**
 * guazi car — detail of one used-car listing by its clue id.
 *
 * Reads the mobile SSR detail page `https://m.guazi.com/car-detail/c<id>.html`:
 * the sale price (`"price":<fen-ish int>`), the spec/condition `label`/`value`
 * pairs embedded in the RSC flight payload, and the condition summary. Returns
 * a key/value sheet. Pure HTML→rows so it is unit-tested against a frozen page.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CAR_COLUMNS,
    EmptyResultError,
    GUAZI_M_BASE,
    clean,
    guaziFetch,
    normalizeClueId,
    requireText,
} from './utils.js';

/** Spec/condition labels worth surfacing, in display order. */
const SPEC_LABELS = ['首次上牌', '表显里程', '过户次数', '车源地', '车身颜色', '发动机', '变速箱', '驱动方式', '排放标准', '车源编号'];

/** Clean Guazi's SEO title down to the car name. */
function cleanTitle(raw) {
    let t = clean(raw);
    t = t.replace(/^【[^】]*】/, '');      // drop a leading 【准新车】-style tag
    t = t.replace(/^二手/, '');            // drop the 二手 prefix
    t = t.replace(/报价[，,].*$/, '');     // drop "报价，真实车源…- 瓜子二手车"
    t = t.replace(/\s*-\s*瓜子二手车.*$/, '');
    return clean(t);
}

/**
 * Pure parser: detail-page HTML → field/value rows. Exported for unit testing.
 */
export function parseCarDetail(html, clueId) {
    const u = String(html || '').replace(/\\"/g, '"');

    const titleM = u.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/)
        || u.match(/"title":"([^"]{6,80})"/);
    const rawTitle = titleM ? titleM[1] : '';
    const tagM = clean(rawTitle).match(/^【([^】]+)】/);

    const priceM = u.match(/"price":(\d{4,8})/);
    const price = priceM ? `${(Number(priceM[1]) / 10000).toFixed(2)}万` : '';

    // label/value pairs from the flight payload (deduped, first wins).
    const labels = {};
    for (const [, k, v] of u.matchAll(/"label":"([^"]{1,12})","value":"([^"]{1,40})"/g)) {
        if (!(k in labels)) labels[k] = clean(v);
    }

    const condM = u.match(/基础车况[^,，"<]{0,16}/);

    const fields = [
        ['clue_id', String(clueId)],
        ['title', rawTitle ? cleanTitle(rawTitle) : ''],
        ['tag', tagM ? tagM[1] : ''],
        ['price', price],
        ['reg_date', labels['首次上牌'] || ''],
        ['mileage', labels['表显里程'] || ''],
        ['transfers', labels['过户次数'] || ''],
        ['source_city', labels['车源地'] || ''],
        ['color', labels['车身颜色'] || ''],
        ['engine', labels['发动机'] || ''],
        ['gearbox', labels['变速箱'] || ''],
        ['drivetrain', labels['驱动方式'] || ''],
        ['emission', labels['排放标准'] || ''],
        ['condition', condM ? clean(condM[0]) : ''],
        ['listing_no', labels['车源编号'] || ''],
        ['url', `${GUAZI_M_BASE}/car-detail/c${clueId}.html`],
    ];
    return fields.map(([field, value]) => ({ field, value }));
}

/** Whether the parsed sheet actually found a car (vs. a 404/empty page). */
function hasData(rows) {
    const map = Object.fromEntries(rows.map((r) => [r.field, r.value]));
    return Boolean(map.title || map.price || map.reg_date);
}

cli({
    site: 'guazi',
    name: 'car',
    access: 'read',
    aliases: ['detail'],
    description: '瓜子二手车车源详情（售价 / 上牌 / 里程 / 过户 / 配置 / 车况）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'clue_id', required: true, positional: true, help: '车源 ID（来自 browse 的 clue_id，或 /car-detail/c<id>.html URL）' },
    ],
    columns: CAR_COLUMNS,
    func: async (args) => {
        const clueId = normalizeClueId(args.clue_id);
        const html = await guaziFetch(`/car-detail/c${clueId}.html`, `car ${clueId}`);
        const rows = parseCarDetail(html, clueId);
        if (!hasData(rows)) {
            throw new EmptyResultError(
                `guazi car ${clueId}`,
                'No listing detail found — the car may have been sold/removed, or the id is wrong.',
            );
        }
        const map = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        requireText(map.title, `guazi car ${clueId} title`);
        requireText(map.price, `guazi car ${clueId} price`);
        return rows;
    },
});
