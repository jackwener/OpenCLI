/**
 * 一亩三分地 版块帖子列表 — /bbs/forum-<fid>-<page>.html
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { fetchHtml, parseThreadList, parseThreadRows, normalizeLimit, BASE } from './utils.js';

cli({
    site: '1point3acres',
    name: 'forum',
    access: 'read',
    description: '浏览一亩三分地某个版块的帖子列表（按 fid）',
    domain: 'www.1point3acres.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'fid', required: true, positional: true, help: '版块 ID，例如 145（海外面经）、198（海外职位内推）、27（研究生申请）' },
        { name: 'page', type: 'int', default: 1, help: '页码（默认 1）' },
        { name: 'limit', type: 'int', default: 20, help: '返回条数（默认 20，最多 50）' },
    ],
    columns: ['rank', 'tid', 'kind', 'title', 'author', 'replies', 'views', 'lastReplyTime', 'url'],
    func: async (args) => {
        const fid = String(args.fid || '').trim();
        if (!/^\d+$/.test(fid)) {
            throw new ArgumentError('fid must be a numeric forum id', 'e.g. 145 for 海外面经');
        }
        const pageNum = Number(args.page ?? 1);
        if (!Number.isInteger(pageNum) || pageNum <= 0) {
            throw new ArgumentError('page must be a positive integer');
        }
        const limit = normalizeLimit(args.limit, 20, 50);
        const html = await fetchHtml(`${BASE}/forum-${fid}-${pageNum}.html`);
        const rows = parseThreadRows(html);
        if (rows.length === 0) {
            // Forum may be sub-category-only — surface gracefully as empty with hint.
            return [];
        }
        const items = parseThreadList(html);
        return items.slice(0, limit).map((t, i) => ({
            rank: i + 1,
            tid: t.tid,
            kind: t.kind === 'stickthread' ? '置顶' : '普通',
            title: t.title,
            author: t.author,
            replies: t.replies,
            views: t.views,
            lastReplyTime: t.lastReplyTime,
            url: t.url,
        }));
    },
});
