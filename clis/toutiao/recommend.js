/**
 * Toutiao channel recommendation feed: the public article stream behind the
 * homepage channel tabs, which `hot` (topic clusters) does not cover.
 *
 * Backed by the public api/pc/feed endpoint. No authentication required.
 * Single-shot: the response echoes a `next.max_behot_time` cursor but does not
 * honour it, so a pagination flag would be a no-op.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    RECOMMEND_CATEGORIES,
    RECOMMEND_URL,
    mapRecommendRow,
    parseRecommendCategory,
    parseRecommendLimit,
} from './utils.js';

cli({
    site: 'toutiao',
    name: 'recommend',
    access: 'read',
    description: '今日头条频道推荐流（公开 API，无需登录）',
    domain: 'www.toutiao.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'category', type: 'string', default: '__all__', help: `频道 (${RECOMMEND_CATEGORIES.join(', ')})` },
        { name: 'limit', type: 'int', default: 20, help: '返回条数 (1-50)' },
    ],
    columns: ['rank', 'group_id', 'title', 'abstract', 'source', 'tag', 'comments', 'published_at', 'url', 'image_url'],
    func: async (kwargs) => {
        const category = parseRecommendCategory(kwargs?.category, '__all__');
        const limit = parseRecommendLimit(kwargs?.limit, 20);
        const url = `${RECOMMEND_URL}?category=${encodeURIComponent(category)}`;
        let resp;
        try {
            resp = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    Accept: 'application/json',
                    Referer: 'https://www.toutiao.com/',
                },
            });
        } catch (error) {
            throw new CommandExecutionError(`toutiao recommend request failed: ${error?.message || error}`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`toutiao recommend failed: HTTP ${resp.status}`);
        }
        let payload;
        try {
            payload = await resp.json();
        } catch (error) {
            throw new CommandExecutionError(`toutiao recommend returned malformed JSON: ${error?.message || error}`);
        }
        if (payload?.message && payload.message !== 'success') {
            throw new CommandExecutionError(`toutiao recommend returned message=${payload.message}`);
        }
        if (!Array.isArray(payload?.data)) {
            throw new CommandExecutionError('toutiao recommend returned a non-array data field');
        }
        const rows = payload.data.map(mapRecommendRow).filter(Boolean).slice(0, limit);
        if (rows.length === 0) {
            throw new EmptyResultError('toutiao recommend', `频道 ${category} 返回空列表。`);
        }
        // Re-rank (1..N) after filter so ranks are dense even if upstream had ads.
        return rows.map((row, idx) => ({ ...row, rank: idx + 1 }));
    },
});
