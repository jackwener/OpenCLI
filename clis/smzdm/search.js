/**
 * 什么值得买搜索好价 — browser cookie, DOM scraping.
 *
 * Fix: The old adapter used `search.smzdm.com/ajax/` which returns 404.
 * New approach: navigate to `search.smzdm.com/?c=home&s=<keyword>&v=b`
 * and scrape the rendered DOM directly.
 *
 * The DOM extractor and helpers live in `./shared.js` because the curated home
 * feed (`hot`) renders identical `li.feed-row-wide` markup and reuses them.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildSmzdmFeedJs, FEED_COLUMNS, parseLimit, requireRows, unwrapEvaluateResult } from './shared.js';

export const smzdmSearchCommand = cli({
    site: 'smzdm',
    name: 'search',
    access: 'read',
    description: '什么值得买搜索好价',
    example: 'opencli smzdm search "无线耳机" --limit 5 -f json',
    domain: 'www.smzdm.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: FEED_COLUMNS,
    func: async (page, kwargs) => {
        const q = encodeURIComponent(kwargs.query);
        const limit = parseLimit(kwargs.limit);
        // Navigate directly to search results page
        await page.goto(`https://search.smzdm.com/?c=home&s=${q}&v=b`);
        return requireRows(await page.evaluate(buildSmzdmFeedJs(limit)));
    },
});

// Names preserved for the existing test suite (search.test.js).
export const __test__ = {
    buildSmzdmSearchJs: buildSmzdmFeedJs,
    parseLimit,
    requireSearchRows: requireRows,
    unwrapEvaluateResult,
};
