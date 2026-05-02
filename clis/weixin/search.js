import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const SOGOU_WEIXIN_DOMAIN = 'weixin.sogou.com';

function normalizePage(page) {
    const parsed = Number.parseInt(String(page ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed < 1)
        return 1;
    return parsed;
}

function normalizeLimit(limit) {
    const parsed = Number.parseInt(String(limit ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed < 1)
        return 10;
    return Math.min(parsed, 10);
}

cli({
    site: 'weixin',
    name: 'search',
    description: '使用搜狗微信搜索公众号文章；如需导出正文 Markdown，请使用 weixin download 处理公众号文章链接',
    domain: SOGOU_WEIXIN_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: '搜索关键词；如需正文 Markdown，请使用 weixin download 处理公众号文章链接' },
        { name: 'page', type: 'int', default: 1, help: '结果页码，从 1 开始' },
        { name: 'limit', type: 'int', default: 10, help: '返回条数，最大 10' },
    ],
    columns: ['rank', 'page', 'title', 'url', 'summary', 'publish_time'],
    func: async (page, kwargs) => {
        const query = String(kwargs.query ?? '').trim();
        if (!query) {
            throw new ArgumentError('A search query is required.', 'Pass a non-empty keyword to search Weixin articles via Sogou.');
        }

        const pageNo = normalizePage(kwargs.page);
        const limit = normalizeLimit(kwargs.limit);
        const searchUrl = new URL('https://weixin.sogou.com/weixin');
        searchUrl.searchParams.set('query', query);
        searchUrl.searchParams.set('type', '2');
        searchUrl.searchParams.set('page', String(pageNo));
        searchUrl.searchParams.set('ie', 'utf8');

        await page.goto(searchUrl.toString());
        await page.wait(2);

        const rows = await page.evaluate(String.raw`(() => {
            const clean = (value) => {
                return (value || '')
                    .replace(/\s+/g, ' ')
                    .replace(/<!--red_beg-->|<!--red_end-->/g, '')
                    .replace(/document\.write\(timeConvert\('\d+'\)\)/g, '')
                    .trim();
            };

            const absolutize = (href) => {
                if (!href) return '';
                try {
                    return new URL(href, window.location.origin).toString();
                } catch {
                    return href;
                }
            };

            return Array.from(document.querySelectorAll('.news-list li')).map((item) => {
                const linkEl = item.querySelector('h3 a[href]');
                const summaryEl = item.querySelector('p.txt-info');
                const timeEl = item.querySelector('.s-p .s2');
                return {
                    title: clean(linkEl && linkEl.textContent),
                    url: absolutize(linkEl && linkEl.getAttribute('href')),
                    summary: clean(summaryEl && summaryEl.textContent),
                    publish_time: clean(timeEl && timeEl.textContent),
                };
            }).filter((row) => row.title && row.url);
        })()`);

        if (!Array.isArray(rows) || rows.length === 0) {
            throw new EmptyResultError('weixin search', 'Try a different keyword or a different page number.');
        }

        return rows.slice(0, limit).map((row, index) => ({
            rank: (pageNo - 1) * 10 + index + 1,
            page: pageNo,
            title: row.title,
            url: row.url,
            summary: row.summary,
            publish_time: row.publish_time,
        }));
    },
});
