/**
 * Douyin comments — every comment of one video, paged to the end.
 *
 * `/aweme/v1/web/comment/list/` pages by `cursor`; it serves at most 50 rows
 * a page (asking for more returns 50 but advances the cursor by the larger
 * count, silently skipping rows), so PAGE_SIZE stays at 50. Replies live
 * behind `/aweme/v1/web/comment/list/reply/` per top-level comment and are
 * only fetched with `--replies`. Douyin rate-limits that endpoint per account
 * far harder than the top-level list: at 0.5 s between requests it raised a
 * verification prompt within the first thread (twice), at 5-10 s a run of
 * ~680 threads went through first (2026-11-24). So each reply request waits
 * REPLY_PAUSE_S first; top-level pages keep the short pause.
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
/** Random 5-10 s before each reply request. */
export const REPLY_PAUSE_S = [5, 10];
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
        { name: 'replies', type: 'bool', default: false, help: 'Also fetch the replies under each comment (one request per reply page, 5-10 s apart to stay under Douyin\'s rate limit)' },
        { name: 'min-replies', type: 'int', default: 1, help: 'With --replies: only open threads whose comment shows at least this many replies (fewer requests, less rate limiting)' },
        { name: 'timeout', type: 'int', default: 1800, help: 'Max seconds for the whole crawl (default: 1800); --replies needs ~8 s per commented thread' },
    ],
    columns: COMMENT_COLUMNS,
    func: async (page, kwargs) => {
        const limit = requireCount(kwargs.limit, 100, MAX_COMMENTS);
        const minReplies = requireCount(kwargs['min-replies'], 1, MAX_COMMENTS, 'min-replies');
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
        // Nothing is returned when a request fails part-way, so the error says
        // how far the crawl got and how to narrow it.
        const withProgress = (error, where) => {
            if (error instanceof Error) {
                error.message = `${error.message} — stopped ${where}; nothing was returned. Retry later, or narrow the crawl with --limit${kwargs.replies === true ? ' / --min-replies' : ''}.`;
            }
            return error;
        };
        try {
            await walkPages(page, (cursor) => browserFetch(page, 'GET',
                `https://www.douyin.com/aweme/v1/web/comment/list/?${new URLSearchParams({ aweme_id: id, cursor: String(cursor), count: String(PAGE_SIZE), aid: '6383' })}`,
            ), 'comments', limit, (c) => {
                const row = toCommentRow(c, id);
                if (!keep(row)) return false;
                top.push(row);
                return true;
            });
        } catch (error) {
            throw withProgress(error, `after ${top.length} top-level comments`);
        }

        if (kwargs.replies === true) {
            const threads = top.filter((r) => r.replies >= minReplies);
            for (const [i, parent] of threads.entries()) {
                if (rows.length >= limit) break;
                const repliesBefore = rows.length - top.length;
                try {
                    await walkPages(page, async (cursor) => {
                        await page.wait({ time: REPLY_PAUSE_S[0] + Math.random() * (REPLY_PAUSE_S[1] - REPLY_PAUSE_S[0]) });
                        return browserFetch(page, 'GET',
                            `https://www.douyin.com/aweme/v1/web/comment/list/reply/?${new URLSearchParams({ item_id: id, comment_id: parent.cid, cursor: String(cursor), count: String(PAGE_SIZE), aid: '6383' })}`);
                    }, 'comments', limit - rows.length, (c) => keep(toCommentRow(c, id, parent.cid)), 0);
                } catch (error) {
                    throw withProgress(error, `at reply thread ${i + 1}/${threads.length} after ${top.length} top-level comments and ${repliesBefore} replies`);
                }
            }
            const order = new Map(top.map((r, i) => [r.cid, i]));
            const threadOf = (r) => order.get(r.parent_cid || r.cid);
            rows.sort((a, b) => threadOf(a) - threadOf(b) || (a.parent_cid ? 1 : 0) - (b.parent_cid ? 1 : 0));
        }

        if (!rows.length) throw new EmptyResultError('douyin comments', `视频 ${id} 没有可见评论`);
        return rows.map((row, i) => ({ rank: i + 1, ...row }));
    },
});
