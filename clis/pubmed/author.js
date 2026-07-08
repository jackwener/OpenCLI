import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    LINK_COLUMNS,
    eutilsFetch,
    fetchSummaryRows,
    requireBoundedInt,
    requireChoice,
    requireText,
    requireYear,
} from './utils.js';

cli({
    site: 'pubmed',
    name: 'author',
    access: 'read',
    description: 'Search PubMed articles by author name and optional affiliation',
    domain: 'pubmed.ncbi.nlm.nih.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'Author name, e.g. "Smith J"' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
        { name: 'affiliation', help: 'Filter by author affiliation' },
        { name: 'position', default: 'any', choices: ['any', 'first', 'last'], help: 'Author position: any, first, or last' },
        { name: 'year-from', type: 'int', help: 'Filter publication year from' },
        { name: 'year-to', type: 'int', help: 'Filter publication year to' },
        { name: 'sort', default: 'date', choices: ['date', 'relevance'], help: 'Sort by date or relevance' },
    ],
    columns: LINK_COLUMNS,
    func: async (args) => {
        const name = requireText(args.name, 'author');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const position = requireChoice(args.position, ['any', 'first', 'last'], 'position', 'any');
        const sort = requireChoice(args.sort, ['date', 'relevance'], 'sort', 'date');
        const yearFrom = requireYear(args['year-from'], 'year-from');
        const yearTo = requireYear(args['year-to'], 'year-to');
        const authorTag = position === 'first' ? '1au' : position === 'last' ? 'lastau' : 'au';
        const terms = [`${name}[${authorTag}]`];
        if (args.affiliation) terms.push(`${requireText(args.affiliation, 'affiliation')}[ad]`);
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
        }, { label: 'pubmed author' });
        const pmids = esearch?.esearchresult?.idlist;
        if (!Array.isArray(pmids)) {
            throw new CommandExecutionError('pubmed author did not return an id list', 'PubMed ESearch response shape may have changed.');
        }
        if (pmids.length === 0) {
            throw new EmptyResultError('pubmed author', `No articles found for author "${name}".`);
        }
        return fetchSummaryRows(pmids, 'pubmed author summary');
    },
});
