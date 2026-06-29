/**
 * 什么值得买首页精选好价流 — browser cookie, DOM scraping.
 *
 * The curated home feed at `/jingxuan/` renders the exact same
 * `li.feed-row-wide` markup as search results, so we reuse the shared feed
 * extractor and only swap the URL. Verified live against
 * https://www.smzdm.com/jingxuan/ (prices + `/p/<id>/` deal URLs).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildSmzdmFeedJs, FEED_COLUMNS, parseLimit, requireRows } from './shared.js';

export const smzdmHotCommand = cli({
    site: 'smzdm',
    name: 'hot',
    access: 'read',
    description: '什么值得买首页精选好价流',
    example: 'opencli smzdm hot --limit 5 -f json',
    domain: 'www.smzdm.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: FEED_COLUMNS,
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit);
        await page.goto('https://www.smzdm.com/jingxuan/');
        return requireRows(await page.evaluate(buildSmzdmFeedJs(limit)));
    },
});

export const __test__ = { buildSmzdmFeedJs, parseLimit, requireRows };
