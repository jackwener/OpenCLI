import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { arxivFetch, parseEntries } from './utils.js';

cli({
  site: 'arxiv',
  name: 'search',
  description: 'Search arXiv papers',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "attention is all you need")' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (max 25)' },
  ],
  columns: ['id', 'title', 'authors', 'published'],
  func: async (_page, args) => {
    const limit = Math.max(1, Math.min(Number(args.limit), 25));
    const query = encodeURIComponent(`all:${args.query}`);
    const xml = await arxivFetch(`search_query=${query}&max_results=${limit}&sortBy=relevance`);
    const entries = parseEntries(xml);
    if (!entries.length) throw new CliError('NOT_FOUND', 'No papers found', 'Try a different keyword');
    return entries.map(e => ({ id: e.id, title: e.title, authors: e.authors, published: e.published }));
  },
});
