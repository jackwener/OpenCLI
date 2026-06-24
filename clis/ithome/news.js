/**
 * ithome news — latest IT之家 news, optionally by channel.
 *
 * Hits the public JSON API `api.ithome.com/json/newslist/<channel>` (default
 * `news`; other channels include `apple` / `android` / `win` / `soft` / `game`
 * …). Each item carries the newsid, title, post time, read/comment counts and
 * the article path, so the rows feed straight into `article`.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    IH_API,
    NEWS_COLUMNS,
    clean,
    requireLimit,
    fmtDateTime,
    articleUrl,
    ihFetchJson,
} from './utils.js';

/**
 * Pure parser: newslist JSON → news rows. Exported for unit testing against the
 * frozen fixture. Reads `toplist` (pinned) before `newslist`, deduped by id.
 */
export function parseNewsRows(json, limit) {
    const items = [
        ...(Array.isArray(json?.toplist) ? json.toplist : []),
        ...(Array.isArray(json?.newslist) ? json.newslist : []),
    ];
    const rows = [];
    const seen = new Set();
    for (const it of items) {
        const newsid = it?.newsid != null ? String(it.newsid) : '';
        const title = clean(it?.title);
        if (!newsid || !title || seen.has(newsid)) continue;
        seen.add(newsid);
        rows.push({
            rank: rows.length + 1,
            newsid,
            title,
            comments: Number.isFinite(Number(it?.commentcount)) ? Number(it.commentcount) : 0,
            hits: Number.isFinite(Number(it?.hitcount)) ? Number(it.hitcount) : 0,
            date: fmtDateTime(it?.postdate),
            url: articleUrl(it?.url),
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

cli({
    site: 'ithome',
    name: 'news',
    access: 'read',
    aliases: ['latest'],
    description: 'IT之家最新资讯（可按频道 news/apple/android/win… 返回标题 + 阅读/评论数 + 文章 URL）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'channel', positional: true, help: '频道 slug，缺省 news；如 apple / android / win / soft / game' },
        { name: 'limit', type: 'int', default: 20, help: '返回的资讯数量（最多 50）' },
    ],
    columns: NEWS_COLUMNS,
    func: async (args) => {
        const channel = (clean(args.channel) || 'news').toLowerCase();
        if (!/^[a-z]+$/.test(channel)) {
            throw new ArgumentError('channel', 'must be a lowercase slug like news / apple / android / win');
        }
        const limit = requireLimit(args.limit, 20, 50);
        const json = await ihFetchJson(`${IH_API}/json/newslist/${channel}`, `news ${channel}`);
        const rows = parseNewsRows(json, limit);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `ithome news ${channel}`,
                `No news returned — "${channel}" may not be a valid channel (try news / apple / android / win).`,
            );
        }
        return rows;
    },
});
