/**
 * hongguo feed — the 推荐 (recommendation) stream from hongguoduanju.com/?tab=feed.
 *
 * `POST /api/home/feed` with `{action:'initial'}` opens a session and sets a
 * `ttwid` cookie; `{action:'load_more', shown_entry_ids}` with that cookie
 * continues it. The server returns at most ~10 items per call (count > 10 is
 * rejected with INVALID_REQUEST) and may repeat a series across pages, so rows
 * are de-duplicated by series_id like the web client does.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    FEED_COLUMNS,
    HG_DOMAIN,
    clean,
    hgFetchJson,
    joinTags,
    requireLimit,
    requireSeriesId,
    seriesUrl,
    toInt,
} from './utils.js';

const PAGE_SIZE = 10;
const MAX_REQUESTS = 10;

function assertFeedPayload(body) {
    if (body?.error_code !== 'OK' || !Array.isArray(body.items)) {
        throw new CommandExecutionError(
            `hongguo feed returned error_code=${body?.error_code ?? 'missing'}`,
            'The recommendation API rejected the request or changed shape.',
        );
    }
    return body;
}

export function parseFeedItem(item) {
    const d = item?.detail || {};
    const seriesId = requireSeriesId(d.series_id, 'hongguo feed item');
    return {
        series_id: seriesId,
        title: clean(d.series_name),
        episodes: toInt(d.episode_cnt),
        tags: joinTags(d.tags),
        intro: clean(d.series_intro),
        url: seriesUrl(seriesId),
    };
}

cli({
    site: 'hongguo',
    name: 'feed',
    access: 'read',
    description: '红果短剧推荐流（首页「推荐」tab）',
    domain: HG_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Number of series (1-50)' },
    ],
    columns: FEED_COLUMNS,
    func: async (args) => {
        const limit = requireLimit(args.limit, 10, 50);
        const rows = [];
        const seen = new Set();
        const shown = [];
        let cookie;
        for (let i = 0; i < MAX_REQUESTS && rows.length < limit; i++) {
            const action = i === 0 ? 'initial' : 'load_more';
            const body = { action, request_id: crypto.randomUUID(), count: PAGE_SIZE };
            if (action === 'load_more' && shown.length) body.shown_entry_ids = shown.slice(-100);
            const res = await hgFetchJson('/api/home/feed', { method: 'POST', body, cookie, label: 'feed' });
            const payload = assertFeedPayload(res.body);
            if (i === 0) cookie = res.cookies.find((c) => c.startsWith('ttwid='));
            for (const item of payload.items) {
                if (item?.entry_id) shown.push(item.entry_id);
                const row = parseFeedItem(item);
                if (seen.has(row.series_id)) continue;
                seen.add(row.series_id);
                rows.push(row);
                if (rows.length >= limit) break;
            }
            if (!payload.has_more || payload.items.length === 0) break;
        }
        if (!rows.length) throw new EmptyResultError('hongguo feed', 'The recommendation stream returned no series.');
        return rows.map((row, idx) => ({ rank: idx + 1, ...row }));
    },
});
