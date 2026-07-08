import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const SOGOU_WEIXIN_DOMAIN = 'weixin.sogou.com';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;

function normalizePositiveInteger(value, name, defaultValue, maxValue) {
    if (value === undefined || value === null)
        return defaultValue;
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) {
        throw new ArgumentError(`weixin search --${name} must be a positive integer`, `Pass --${name} as a whole number${maxValue ? ` from 1 to ${maxValue}` : ' greater than 0'}.`);
    }
    const parsed = Number(text);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || (maxValue && parsed > maxValue)) {
        throw new ArgumentError(`weixin search --${name} is out of range`, `Pass --${name} as a whole number${maxValue ? ` from 1 to ${maxValue}` : ' greater than 0'}.`);
    }
    return parsed;
}

function normalizePage(page) {
    return normalizePositiveInteger(page, 'page', DEFAULT_PAGE);
}

function normalizeLimit(limit) {
    return normalizePositiveInteger(limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT);
}

function buildSearchUrl(query, pageNo) {
    const searchUrl = new URL('https://weixin.sogou.com/weixin');
    searchUrl.searchParams.set('query', query);
    searchUrl.searchParams.set('type', '2');
    searchUrl.searchParams.set('page', String(pageNo));
    searchUrl.searchParams.set('ie', 'utf8');
    return searchUrl.toString();
}

function buildExtractSearchResultsEvaluate() {
    return String.raw`(() => {
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

        const bodyText = clean(document.body && document.body.innerText);
        const blocked = /验证码|安全验证|异常访问|访问过于频繁|请输入验证码/.test(bodyText);
        const empty = /没有找到相关的微信文章|未找到相关|暂无相关|没有找到/.test(bodyText)
            || Boolean(document.querySelector('.no-result, .no_result, .s-noresult'));
        const cards = Array.from(document.querySelectorAll('.news-list li'));
        const extracted = cards.map((item) => {
            const linkEl = item.querySelector('h3 a[href]');
            const summaryEl = item.querySelector('p.txt-info');
            const timeEl = item.querySelector('.s-p .s2');
            return {
                title: clean(linkEl && linkEl.textContent),
                url: absolutize(linkEl && linkEl.getAttribute('href')),
                summary: clean(summaryEl && summaryEl.textContent),
                publish_time: clean(timeEl && timeEl.textContent),
            };
        });
        const rows = extracted.filter((row) => row.title && row.url);

        return {
            blocked,
            empty,
            cardCount: cards.length,
            invalidCount: extracted.length - rows.length,
            rows,
        };
    })()`;
}

cli({
    site: 'weixin',
    name: 'search',
    access: 'read',
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
        const searchUrl = buildSearchUrl(query, pageNo);

        let payload;
        try {
            await page.goto(searchUrl);
            await page.wait(2);
            payload = await page.evaluate(buildExtractSearchResultsEvaluate());
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new CommandExecutionError('weixin search failed while loading Sogou results', detail);
        }

        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) {
            throw new CommandExecutionError('weixin search returned an unreadable browser payload', 'Sogou Weixin may have changed its result page structure.');
        }
        if (payload.blocked) {
            throw new CommandExecutionError('Sogou Weixin blocked this search request', 'Open weixin.sogou.com in Chrome and complete any verification before retrying.');
        }
        if (payload.invalidCount > 0) {
            throw new CommandExecutionError('Sogou Weixin returned article cards without required title or URL', 'The result page structure may have changed; refusing to return a partial result set.');
        }

        const rows = payload.rows;
        if (rows.length === 0 && payload.empty) {
            throw new EmptyResultError('weixin search', 'Try a different keyword or a different page number.');
        }
        if (rows.length === 0) {
            throw new CommandExecutionError('weixin search did not expose article result cards', 'Sogou Weixin may have changed its selectors or returned a transient shell page.');
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

export const __test__ = {
    MAX_LIMIT,
    normalizePage,
    normalizeLimit,
    buildSearchUrl,
    buildExtractSearchResultsEvaluate,
};
