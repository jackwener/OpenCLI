import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { browserFetch } from './_shared/browser-fetch.js';

// The creator item list is where the per-work metric set lives: play, completion,
// 2s bounce, cover impressions/CTR, fan-vs-visitor split and follow conversion,
// 26 fields in total. It is cursor-paginated the same way work_list is.
const ITEM_LIST_URL = 'https://creator.douyin.com/web/api/creator/item/list';
const PAGE_SIZE = 50;
const MAX_HOPS = 50;

export function normalizeAwemeId(raw) {
    const value = String(raw ?? '').trim();
    if (!/^\d{16,20}$/.test(value)) {
        throw new ArgumentError('douyin stats aweme_id must be a 16-20 digit numeric ID');
    }
    return value;
}

export function sameAwemeId(value, target) {
    if (value == null)
        return false;
    const source = String(value);
    if (source === target)
        return true;
    // This endpoint serializes the work id as a JSON number, so the browser's
    // JSON.parse has already rounded it to IEEE-754 precision before the adapter
    // sees it. Compare numerically as well so the lookup still resolves.
    return /^\d+$/.test(source) && Number(source) === Number(target);
}

cli({
    site: 'douyin',
    name: 'stats',
    access: 'read',
    description: '获取单个作品的创作者中心深层指标',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'aweme_id', required: true, positional: true, help: '抖音作品 ID（aweme_id，可从作品 URL 末尾获取）' },
    ],
    columns: ['metric', 'value'],
    func: async (page, kwargs) => {
        const awemeId = normalizeAwemeId(kwargs.aweme_id);
        let cursor;

        for (let hop = 0; hop < MAX_HOPS; hop++) {
            const params = new URLSearchParams({
                count: String(PAGE_SIZE),
                order_by: '1',
                fields: 'metrics,review,visibility',
                need_cooperation: 'true',
                need_long_article: 'true',
            });
            if (cursor !== undefined)
                params.set('max_cursor', String(cursor));

            const response = await browserFetch(page, 'GET', `${ITEM_LIST_URL}?${params.toString()}`);
            const item = (response.items ?? []).find((candidate) => sameAwemeId(candidate?.id, awemeId));
            if (item) {
                const metrics = item.metrics;
                if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
                    throw new EmptyResultError(`douyin stats ${awemeId}`, 'The work exists, but creator metrics are unavailable');
                }
                return Object.entries(metrics).map(([metric, value]) => ({ metric, value }));
            }

            const nextCursor = response.max_cursor;
            if (!response.has_more || nextCursor === undefined || nextCursor === null
                || (cursor !== undefined && String(nextCursor) === String(cursor))) {
                break;
            }
            cursor = nextCursor;
        }

        throw new EmptyResultError(`douyin stats ${awemeId}`, 'The work was not found in the logged-in creator account');
    },
});
