/**
 * 一亩三分地 站内搜索 — /bbs/search.php?mod=forum
 *
 * Guests get a "请登录" alert page, so this command needs the live browser
 * session's cookie. Discuz routes search through a 302 redirect to
 * search.php?searchid=<ID>. Node fetch follows redirects automatically as
 * long as we pass the session cookie along.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { fetchHtml, parseSearchList, assertNotGuestAlert, getCookie, decodeEntities, normalizeLimit, BASE } from './utils.js';

cli({
    site: '1point3acres',
    name: 'search',
    access: 'read',
    description: '一亩三分地 站内关键字搜索（需要登录）',
    domain: 'www.1point3acres.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'query', required: true, positional: true, help: '搜索关键字' },
        { name: 'limit', type: 'int', default: 20, help: '返回条数（默认 20，最多 50）' },
        { name: 'fid', type: 'string', default: '', help: '限定版块 ID（可选）' },
    ],
    columns: ['rank', 'tid', 'title', 'forum', 'author', 'replies', 'views', 'postTime', 'url'],
    func: async (page, args) => {
        const query = String(args.query || '').trim();
        if (!query) throw new ArgumentError('query 不能为空');
        const limit = normalizeLimit(args.limit, 20, 50);
        const fid = String(args.fid || '').trim();

        const cookie = await getCookie(page);
        const qs = new URLSearchParams({
            mod: 'forum',
            srchtxt: query,
            searchsubmit: 'yes',
            ...(fid ? { srchfid: fid } : {}),
        });
        const url = `${BASE}/search.php?${qs.toString()}`;

        // Node fetch with the session cookie — Discuz's 302 to search.php?searchid=…
        // is followed by default.
        const html = await fetchHtml(url, {
            cookie,
            headers: { Referer: `${BASE}/` },
        });
        assertNotGuestAlert(html);

        const items = parseSearchList(html);
        if (items.length === 0) {
            const hint = html.match(/<p>([^<]*?抱歉[^<]*?)<\/p>/);
            if (hint) {
                throw new EmptyResultError('1point3acres search', decodeEntities(hint[1].trim()));
            }
            throw new EmptyResultError('1point3acres search', `No results for "${query}"`);
        }
        return items.slice(0, limit).map((t, i) => ({
            rank: i + 1,
            tid: t.tid,
            title: t.title,
            forum: t.forum,
            author: t.author,
            replies: t.replies,
            views: t.views,
            postTime: t.postTime,
            url: t.url,
        }));
    },
});
