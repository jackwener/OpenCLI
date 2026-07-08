import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    SEARCH_COLUMNS,
    eutilsFetch,
    fetchSummaryRows,
    requireBoundedInt,
    requireChoice,
    requireText,
} from './utils.js';

cli({
    site: 'pubmed',
    name: 'mesh',
    access: 'read',
    description: 'Search PubMed articles by MeSH term',
    domain: 'pubmed.ncbi.nlm.nih.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'term', positional: true, required: true, help: 'MeSH term, e.g. "Neoplasms" or "Machine Learning"' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
        { name: 'major', type: 'boolean', default: false, help: 'Only include articles where this is a major MeSH topic' },
        { name: 'sort', default: 'relevance', choices: ['relevance', 'date'], help: 'Sort by relevance or date' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (args) => {
        const term = requireText(args.term, 'term');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const sort = requireChoice(args.sort, ['relevance', 'date'], 'sort', 'relevance');
        const tag = args.major ? 'Majr' : 'MeSH Terms';
        const esearch = await eutilsFetch('esearch', {
            term: `${term}[${tag}]`,
            retmax: limit,
            usehistory: 'y',
            sort: sort === 'date' ? 'pub_date' : '',
        }, { label: 'pubmed mesh' });
        const pmids = esearch?.esearchresult?.idlist;
        if (!Array.isArray(pmids)) {
            throw new CommandExecutionError('pubmed mesh did not return an id list', 'PubMed ESearch response shape may have changed.');
        }
        if (pmids.length === 0) {
            throw new EmptyResultError('pubmed mesh', `No articles found for MeSH term "${term}".`);
        }
        return fetchSummaryRows(pmids, 'pubmed mesh summary');
    },
});
