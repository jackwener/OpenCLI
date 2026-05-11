/**
 * Reuters news search — uses the in-page articles-by-search-v2 API.
 *
 * The endpoint sits behind a Datadome anti-bot challenge for direct fetches,
 * so we run inside an authenticated reuters.com tab via Strategy.COOKIE.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildSearchScript, isAuthStatus, looksAuthWallText, mapSearchArticles, parseLimit } from './utils.js';

cli({
    site: 'reuters',
    name: 'search',
    access: 'read',
    description: 'Reuters 路透社新闻搜索',
    domain: 'www.reuters.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (1-40)' },
    ],
    columns: ['rank', 'title', 'date', 'section', 'section_path', 'authors', 'url'],
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit);
        const query = String(kwargs.query || '').trim();
        if (!query) {
            throw new ArgumentError('Search query cannot be empty', 'Provide a non-empty keyword');
        }
        await page.goto('https://www.reuters.com');
        await page.wait(2);
        const result = await page.evaluate(buildSearchScript(query, limit));
        if (result?.error) {
            throw new CommandExecutionError(`Reuters search failed inside the page: ${result.error}`);
        }
        if (!result || typeof result !== 'object') {
            throw new CommandExecutionError('Reuters search API returned an unreadable response');
        }
        if (isAuthStatus(result.status) || looksAuthWallText(result.textPreview)) {
            throw new AuthRequiredError(
                'www.reuters.com',
                `Reuters search requires an accessible Reuters browser session or completed human verification${result.status ? ` (HTTP ${result.status})` : ''}`,
            );
        }
        if (result.ok !== true) {
            const status = Number.isFinite(result.status) && result.status > 0
                ? `HTTP ${result.status}${result.statusText ? ` ${result.statusText}` : ''}`
                : 'no upstream response';
            throw new CommandExecutionError(`Reuters search API failed (${status})`);
        }
        if (!result.body) {
            const detail = result.parseError ? `: ${result.parseError}` : '';
            throw new CommandExecutionError(
                `Reuters search returned a non-JSON body${detail}`,
                'Open www.reuters.com in your browser and clear any challenge before retrying.',
            );
        }
        const rows = mapSearchArticles(result.body, limit);
        if (!rows.length) {
            throw new EmptyResultError('reuters search', `No articles matched "${query}". Try broadening the query.`);
        }
        return rows;
    },
});
