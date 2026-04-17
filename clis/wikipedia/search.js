import { CliError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { wikiFetch } from './utils.js';
cli({
    site: 'wikipedia',
    name: 'search',
    description: 'Search Wikipedia articles',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 10, help: 'Max results' },
        { name: 'lang', default: 'en', help: 'Language code (e.g. en, zh, ja)' },
    ],
    columns: ['title', 'snippet', 'url'],
    func: async (_page, args) => {
        const limit = Math.max(1, Math.min(Number(args.limit), 50));
        const lang = args.lang || 'en';
        const q = encodeURIComponent(args.query);
        const data = (await wikiFetch(lang, `/w/api.php?action=query&list=search&srsearch=${q}&srlimit=${limit}&format=json&utf8=1`));
        const results = data?.query?.search;
        if (!results?.length)
            throw new CliError('NOT_FOUND', 'No articles found', 'Try a different keyword');
        return results.map((r) => ({
            title: r.title,
            snippet: r.snippet.replace(/<[^>]+>/g, '').slice(0, 120),
            url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
        }));
    },
});
