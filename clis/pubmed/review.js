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
    name: 'review',
    access: 'read',
    description: 'Search PubMed review articles with a review preset',
    domain: 'pubmed.ncbi.nlm.nih.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Review topic query, e.g. "immunotherapy"' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
        { name: 'year-from', type: 'int', help: 'Filter publication year from' },
        { name: 'year-to', type: 'int', help: 'Filter publication year to' },
        { name: 'has-abstract', type: 'boolean', default: false, help: 'Only include articles with abstracts' },
        { name: 'sort', default: 'date', choices: ['date', 'relevance'], help: 'Sort by date or relevance' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (args) => {
        const query = requireText(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const yearFrom = requireYear(args['year-from'], 'year-from');
        const yearTo = requireYear(args['year-to'], 'year-to');
        const sort = requireChoice(args.sort, ['date', 'relevance'], 'sort', 'date');
        const searchQuery = buildSearchQuery(query, {
            yearFrom,
            yearTo,
            articleType: 'Review',
            hasAbstract: args['has-abstract'],
        });
        const esearch = await eutilsFetch('esearch', {
            term: searchQuery,
            retmax: limit,
            usehistory: 'y',
            sort: sort === 'date' ? 'pub_date' : '',
        }, { label: 'pubmed review' });
        const pmids = esearch?.esearchresult?.idlist;
        if (!Array.isArray(pmids)) {
            throw new CommandExecutionError('pubmed review did not return an id list', 'PubMed ESearch response shape may have changed.');
        }
        if (pmids.length === 0) {
            throw new EmptyResultError('pubmed review', `No review articles matched "${query}".`);
        }
        return fetchSummaryRows(pmids, 'pubmed review summary');
    },
});
