/**
 * 一亩三分地 我的通知 — 坛友互动 / 点评 / @我 等
 *
 * /bbs/home.php?mod=space&do=notice&view=interactive  needs login cookie.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { fetchHtml, decodeEntities, getCookie, stripHtml, truncate, normalizePositiveInteger, BASE } from './utils.js';

cli({
    site: '1point3acres',
    name: 'notifications',
    access: 'read',
    description: '一亩三分地 站内通知（互动 / 点评 / @ 我；需要登录）',
    domain: 'www.1point3acres.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'kind', type: 'string', default: 'mypost',
          help: '通知类型：mypost（我的帖子） / interactive（互动） / system（系统） / app（应用）' },
        { name: 'limit', type: 'int', default: 20, help: '返回条数' },
    ],
    columns: ['index', 'from', 'summary', 'time', 'threadUrl'],
    func: async (page, args) => {
        const kind = String(args.kind || 'mypost').trim();
        const cookie = await getCookie(page);
        const url = `${BASE}/home.php?mod=space&do=notice&view=${encodeURIComponent(kind)}`;
        const html = await fetchHtml(url, { cookie, headers: { Referer: `${BASE}/` } });

        if (/<title>提示信息/.test(html) && /请登录/.test(html)) {
            throw new AuthRequiredError('www.1point3acres.com', '请先登录一亩三分地');
        }

        // "No notifications" is a real empty result, not a synthetic data row.
        if (/暂时没有提醒内容/.test(html)) {
            throw new EmptyResultError('1point3acres notifications', '暂时没有提醒内容');
        }

        const rows = [];
        const limit = normalizePositiveInteger(args.limit, 20, 'limit');

        // Pattern 1: standard Discuz <dl class="cl">…</dl> block per notice.
        const dlRe = /<dl class="[^"]*cl[^"]*"[^>]*>([\s\S]*?)<\/dl>/g;
        let m;
        let i = 0;
        while ((m = dlRe.exec(html)) && rows.length < limit) {
            const block = m[1];
            const from = decodeEntities((block.match(/<dt>([\s\S]*?)<\/dt>/) || [, ''])[1])
                .replace(/<[^>]+>/g, '').trim();
            const summaryRaw = (block.match(/<dd class="ntc_body">([\s\S]*?)<\/dd>/) ||
                               block.match(/<dd>([\s\S]*?)<\/dd>/) || [, ''])[1];
            const summary = truncate(stripHtml(summaryRaw), 200);
            const time = ((block.match(/<dd class="[^"]*xg1[^"]*"[^>]*>([\s\S]*?)<\/dd>/) || [, ''])[1] || '')
                .replace(/<[^>]+>/g, '').trim();
            const linkMatch = summaryRaw.match(/href="([^"]*thread-\d+[^"]*)"/);
            const threadUrl = linkMatch ? (linkMatch[1].startsWith('http') ? linkMatch[1] : `${BASE}/${linkMatch[1]}`) : '';
            i += 1;
            if (!from && !summary) continue;
            rows.push({ index: i, from, summary, time, threadUrl });
        }
        return rows;
    },
});
