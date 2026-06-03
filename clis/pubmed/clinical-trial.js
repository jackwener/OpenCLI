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
    name: 'clinical-trial',
    access: 'read',
    description: 'Search PubMed clinical trials with a trial-study preset',
    domain: 'pubmed.ncbi.nlm.nih.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Clinical topic query, e.g. "breast cancer"' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
        { name: 'year-from', type: 'int', help: 'Filter publication year from' },
        { name: 'year-to', type: 'int', help: 'Filter publication year to' },
        { name: 'free-full-text', type: 'boolean', default: false, help: 'Only include free full text articles' },
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
            articleType: 'Clinical Trial',
            hasFullText: args['free-full-text'],
            humanOnly: true,
        });
        const esearch = await eutilsFetch('esearch', {
            term: searchQuery,
            retmax: limit,
            usehistory: 'y',
            sort: sort === 'date' ? 'pub_date' : '',
        }, { label: 'pubmed clinical-trial' });
        const pmids = esearch?.esearchresult?.idlist;
        if (!Array.isArray(pmids)) {
            throw new CommandExecutionError('pubmed clinical-trial did not return an id list', 'PubMed ESearch response shape may have changed.');
        }
        if (pmids.length === 0) {
            throw new EmptyResultError('pubmed clinical-trial', `No clinical trial articles matched "${query}".`);
        }
        return fetchSummaryRows(pmids, 'pubmed clinical-trial summary');
    },
});
