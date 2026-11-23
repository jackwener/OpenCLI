/**
 * Douyin comments — every comment of one video, paged to the end.
 *
 * `/aweme/v1/web/comment/list/` pages by `cursor`; it serves at most 50 rows
 * a page (asking for more returns 50 but advances the cursor by the larger
 * count, silently skipping rows), so PAGE_SIZE stays at 50. Replies live
 * behind `/aweme/v1/web/comment/list/reply/` per top-level comment and are
 * only fetched with `--replies`.
 *
 * Like `douyin detail`, requests run inside a logged-in www.douyin.com video
 * page so the site's own JS signs them. The listed total includes folded and
 * deleted comments the web never serves, so a full crawl lands below it
 * (one 1,376-comment video measured 2026-11-23: 987 top-level + 201 replies).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { browserFetch } from './_shared/browser-fetch.js';
import { resolveToId } from './_shared/video-id.js';
import { formatChinaTime, requireCount, walkPages } from './_shared/paging.js';

export const PAGE_SIZE = 50;
export const MAX_COMMENTS = 20000;
export const COMMENT_COLUMNS = ['rank', 'cid', 'parent_cid', 'user', 'text', 'likes', 'replies', 'time', 'ip_label', 'aweme_id'];

export function toCommentRow(c, awemeId, parentCid = '') {
    return {
        cid: String(c.cid ?? ''),
        parent_cid: parentCid,
        user: c.user?.nickname ?? '',
        text: c.text ?? '',
        likes: c.digg_count ?? 0,
        replies: parentCid ? null : (c.reply_comment_total ?? 0),
        time: formatChinaTime(c.create_time),
        ip_label: c.ip_label ?? '',
        aweme_id: awemeId,
    };
}

cli({
    site: 'douyin',
    name: 'comments',
    access: 'read',
    description: '单条视频的全部评论（按游标翻到底，可选带回复）',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    example: 'opencli douyin comments 7697274002573872394 --limit 500 --replies -f json',
    args: [
        { name: 'target', required: true, positional: true, help: '视频 ID / 视频链接 / 分享短链' },
        { name: 'limit', type: 'int', default: 100, help: `Max rows, replies included (1-${MAX_COMMENTS})` },
        { name: 'replies', type: 'bool', default: false, help: 'Also fetch the replies under each comment (one extra request per commented thread)' },
        { name: 'timeout', type: 'int', default: 600, help: 'Max seconds for the whole crawl (default: 600); raise it for long threads' },
    ],
    columns: COMMENT_COLUMNS,
    func: async (page, kwargs) => {
        const limit = requireCount(kwargs.limit, 100, MAX_COMMENTS);
        const id = await resolveToId(String(kwargs.target ?? '').trim());
        if (!id) throw new ArgumentError('没能从输入里解析出视频 ID');
        await page.goto(`https://www.douyin.com/video/${id}`);
        await page.wait({ time: 2.5 });

        const rows = [];
        const seen = new Set();
        const keep = (row) => {
            if (!row.cid || seen.has(row.cid)) return false;
            seen.add(row.cid);
            rows.push(row);
            return true;
        };
        const top = [];
        await walkPages(page, (cursor) => browserFetch(page, 'GET',
            `https://www.douyin.com/aweme/v1/web/comment/list/?${new URLSearchParams({ aweme_id: id, cursor: String(cursor), count: String(PAGE_SIZE), aid: '6383' })}`,
        ), 'comments', limit, (c) => {
            const row = toCommentRow(c, id);
            if (!keep(row)) return false;
            top.push(row);
            return true;
        });

        if (kwargs.replies === true) {
            for (const parent of top) {
                if (rows.length >= limit) break;
                if (!parent.replies) continue;
                await walkPages(page, (cursor) => browserFetch(page, 'GET',
                    `https://www.douyin.com/aweme/v1/web/comment/list/reply/?${new URLSearchParams({ item_id: id, comment_id: parent.cid, cursor: String(cursor), count: String(PAGE_SIZE), aid: '6383' })}`,
                ), 'comments', limit - rows.length, (c) => keep(toCommentRow(c, id, parent.cid)));
                await page.wait({ time: 0.5 });
            }
            const order = new Map(top.map((r, i) => [r.cid, i]));
            const threadOf = (r) => order.get(r.parent_cid || r.cid);
            rows.sort((a, b) => threadOf(a) - threadOf(b) || (a.parent_cid ? 1 : 0) - (b.parent_cid ? 1 : 0));
        }

        if (!rows.length) throw new EmptyResultError('douyin comments', `视频 ${id} 没有可见评论`);
        return rows.map((row, i) => ({ rank: i + 1, ...row }));
    },
});
