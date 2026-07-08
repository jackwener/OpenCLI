import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    SEARCH_COLUMNS,
    eutilsFetch,
    fetchSummaryRows,
    requireBoundedInt,
    requireChoice,
    requireText,
    requireYear,
} from './utils.js';

cli({
    site: 'pubmed',
    name: 'journal',
    access: 'read',
    description: 'Search PubMed articles by journal name',
    domain: 'pubmed.ncbi.nlm.nih.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'journal', positional: true, required: true, help: 'Journal name, e.g. "Nature" or "The Lancet"' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
        { name: 'year-from', type: 'int', help: 'Filter publication year from' },
        { name: 'year-to', type: 'int', help: 'Filter publication year to' },
        { name: 'sort', default: 'relevance', choices: ['relevance', 'date'], help: 'Sort by relevance or date' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (args) => {
        const journal = requireText(args.journal, 'journal');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const yearFrom = requireYear(args['year-from'], 'year-from');
        const yearTo = requireYear(args['year-to'], 'year-to');
        const sort = requireChoice(args.sort, ['relevance', 'date'], 'sort', 'relevance');
        const terms = [`${journal}[Journal]`];
        if (yearFrom || yearTo) {
            const from = yearFrom || 1800;
            const to = yearTo || new Date().getFullYear();
            if (from > to) {
                throw new ArgumentError('pubmed year-from must be <= year-to');
            }
            terms.push(`${from}:${to}[PDAT]`);
        }
        const esearch = await eutilsFetch('esearch', {
            term: terms.join(' AND '),
            retmax: limit,
            usehistory: 'y',
            sort: sort === 'date' ? 'pub_date' : '',
        }, { label: 'pubmed journal' });
        const pmids = esearch?.esearchresult?.idlist;
        if (!Array.isArray(pmids)) {
            throw new CommandExecutionError('pubmed journal did not return an id list', 'PubMed ESearch response shape may have changed.');
        }
        if (pmids.length === 0) {
            throw new EmptyResultError('pubmed journal', `No articles found for journal "${journal}".`);
        }
        return fetchSummaryRows(pmids, 'pubmed journal summary');
    },
});
