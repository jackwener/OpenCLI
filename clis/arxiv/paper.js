import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { arxivFetch, parseEntries } from './utils.js';
cli({
    site: 'arxiv',
    name: 'paper',
    description: 'Get arXiv paper details by ID',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'arXiv paper ID (e.g. 1706.03762)' },
    ],
    columns: ['id', 'title', 'authors', 'published', 'abstract', 'url'],
    func: async (_page, args) => {
        const xml = await arxivFetch(`id_list=${encodeURIComponent(args.id)}`);
        const entries = parseEntries(xml);
        if (!entries.length)
            throw new CliError('NOT_FOUND', `Paper ${args.id} not found`, 'Check the arXiv ID format, e.g. 1706.03762');
        return entries;
    },
});
