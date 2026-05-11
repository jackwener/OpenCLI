import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { arxivFetch, normalizeArxivCategory, normalizeArxivLimit, parseEntries } from './utils.js';
cli({
    site: 'arxiv',
    name: 'recent',
    access: 'read',
    description: 'List recent arXiv submissions in a category',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'category', positional: true, required: true, help: 'arXiv category (e.g. cs.CL, cs.LG, math.PR, q-bio.NC)' },
        { name: 'limit', type: 'int', default: 10, help: 'Max results (max 50)' },
    ],
    columns: ['id', 'title', 'authors', 'published', 'primary_category', 'url'],
    func: async (args) => {
        const category = normalizeArxivCategory(args.category);
        const limit = normalizeArxivLimit(args.limit, 10, 50);
        const query = encodeURIComponent(`cat:${category}`);
        const xml = await arxivFetch(`search_query=${query}&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`);
        const entries = parseEntries(xml);
        if (!entries.length)
            throw new EmptyResultError('arxiv', `No recent papers in ${category}. Check the category name.`);
        return entries.map(e => ({
            id: e.id,
            title: e.title,
            authors: e.authors,
            published: e.published,
            primary_category: e.primary_category,
            url: e.url,
        }));
    },
});
