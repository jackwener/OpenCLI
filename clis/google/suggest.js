/**
 * Google Search Suggestions via public JSON API.
 * Uses suggestqueries.google.com with client=firefox for pure JSON (not JSONP).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
cli({
    site: 'google',
    name: 'suggest',
    access: 'read',
    description: 'Get Google search suggestions',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'keyword', positional: true, required: true, help: 'Search query' },
        { name: 'lang', default: 'zh-CN', help: 'Language code' },
    ],
    columns: ['suggestion'],
    func: async (args) => {
        const keyword = encodeURIComponent(args.keyword);
        const lang = encodeURIComponent(args.lang);
        const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${keyword}&hl=${lang}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new CliError('FETCH_ERROR', `HTTP ${resp.status}`, 'Check your network connection');
        }
        const data = await resp.json();
        // Response format: ["query", ["suggestion1", "suggestion2", ...]]
        const suggestions = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
        if (!suggestions.length) {
            throw new CliError('NOT_FOUND', 'No suggestions found', 'Try a different keyword');
        }
        return suggestions.map(s => ({ suggestion: s }));
    },
});
