import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    SEARCH_COLUMNS,
    buildSearchQuery,
    eutilsFetch,
    fetchSummaryRows,
    requireBoundedInt,
    requireChoice,
    requireText,
    requireYear,
} from './utils.js';

cli({
    site: 'pubmed',
    name: 'search',
    access: 'read',
    description: 'Search PubMed articles with advanced filters',
    domain: 'pubmed.ncbi.nlm.nih.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search query, e.g. "machine learning cancer"' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
        { name: 'author', help: 'Filter by author name' },
        { name: 'journal', help: 'Filter by journal name' },
        { name: 'year-from', type: 'int', help: 'Filter publication year from' },
        { name: 'year-to', type: 'int', help: 'Filter publication year to' },
        { name: 'article-type', help: 'Filter by publication type, e.g. Review or Clinical Trial' },
        { name: 'has-abstract', type: 'boolean', default: false, help: 'Only include articles with abstracts' },
        { name: 'free-full-text', type: 'boolean', default: false, help: 'Only include free full text articles' },
        { name: 'humans-only', type: 'boolean', default: false, help: 'Only include human studies' },
        { name: 'english-only', type: 'boolean', default: false, help: 'Only include English articles' },
        { name: 'sort', default: 'relevance', choices: ['relevance', 'date', 'author', 'journal'], help: 'Sort by relevance, date, author, or journal' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (args) => {
        const query = requireText(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const yearFrom = requireYear(args['year-from'], 'year-from');
        const yearTo = requireYear(args['year-to'], 'year-to');
        const sort = requireChoice(args.sort, ['relevance', 'date', 'author', 'journal'], 'sort', 'relevance');
        const sortMap = {
            relevance: '',
            date: 'pub_date',
            author: 'Author',
            journal: 'JournalName',
        };
        const searchQuery = buildSearchQuery(query, {
            author: args.author,
            journal: args.journal,
            yearFrom,
            yearTo,
            articleType: args['article-type'],
            hasAbstract: args['has-abstract'],
            hasFullText: args['free-full-text'],
            humanOnly: args['humans-only'],
            englishOnly: args['english-only'],
        });
        const esearch = await eutilsFetch('esearch', {
            term: searchQuery,
            retmax: limit,
            usehistory: 'y',
            sort: sortMap[sort],
        }, { label: 'pubmed search' });
        const pmids = esearch?.esearchresult?.idlist;
        if (!Array.isArray(pmids)) {
            throw new CommandExecutionError('pubmed search did not return an id list', 'PubMed ESearch response shape may have changed.');
        }
        if (pmids.length === 0) {
            throw new EmptyResultError('pubmed search', `No articles matched "${query}".`);
        }
        return fetchSummaryRows(pmids, 'pubmed search summary');
    },
});
