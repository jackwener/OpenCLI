// nodeseek search — full-text search over NodeSeek posts.
//
// Results are server-rendered as `.post-list-item` (same shape as the home /
// category feed), so scraping + finalizing is shared with `latest` via client.js.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { ensureNsHome, hasNsSessionCookie, readLimit, NS_HOME, scrapePostList, finalizeListRows } from './client.js';

cli({
    site: 'nodeseek',
    name: 'search',
    access: 'read',
    description: 'Full-text search over NodeSeek posts (requires login)',
    domain: 'nodeseek.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: ['post_id', 'title', 'category', 'author', 'time', 'link'],
    func: async (page, kwargs) => {
        const q = String(kwargs.query || '').trim();
        if (!q)
            throw new ArgumentError('nodeseek search', 'Search keyword must not be empty');
        const limit = readLimit(kwargs.limit, { max: 100, command: 'nodeseek search' });
        await ensureNsHome(page);
        if (!await hasNsSessionCookie(page))
            throw new AuthRequiredError('nodeseek', 'search requires login — run `opencli nodeseek login`');
        await page.goto(`${NS_HOME}/search?q=${encodeURIComponent(q)}&type=post`);
        await page.wait(2);

        const scraped = await scrapePostList(page);
        const rows = finalizeListRows(Array.isArray(scraped) ? scraped : [], limit);
        if (rows.length === 0)
            throw new EmptyResultError('nodeseek search', `No posts found for "${q}"`);
        return rows;
    },
});
