// arxiv since — list submissions in a category inside a UTC date window.
//
// Why this exists: "arxiv recent" can only answer "the latest N", so a quiet day
// and a busy day come back looking the same and you cannot tell a quiet window
// from a truncated one. This command takes an explicit window and reports the
// real match count when the window holds more than --limit returns.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';
import {
    arxivFetch,
    normalizeArxivCategory,
    normalizeArxivLimit,
    parseEntries,
    parseTotalResults,
    resolveSubmittedRange,
} from './utils.js';

cli({
    site: 'arxiv',
    name: 'since',
    access: 'read',
    description: 'List arXiv submissions in a category within a date window (default: last 7 days, UTC)',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'category', positional: true, required: true, help: 'arXiv category (e.g. cs.CL, cs.LG, math.PR, q-bio.NC)' },
        { name: 'days', type: 'int', help: 'Look back N days including today (default 7). Cannot be combined with --from/--to.' },
        { name: 'from', type: 'string', help: 'Window start, inclusive (YYYY-MM-DD, UTC)' },
        { name: 'to', type: 'string', help: 'Window end, inclusive (YYYY-MM-DD, UTC; default: today)' },
        { name: 'limit', type: 'int', default: 50, help: 'Max results (max 200)' },
    ],
    columns: ['id', 'title', 'authors', 'published', 'primary_category', 'url'],
    func: async (args) => {
        const category = normalizeArxivCategory(args.category);
        const limit = normalizeArxivLimit(args.limit, 50, 200);
        const range = resolveSubmittedRange({ days: args.days, from: args.from, to: args.to });
        const query = encodeURIComponent('cat:' + category + ' AND ' + range.range);
        const xml = await arxivFetch('search_query=' + query + '&max_results=' + limit + '&sortBy=submittedDate&sortOrder=descending');
        const entries = parseEntries(xml);
        if (!entries.length) {
            throw new EmptyResultError('arxiv since', 'No ' + category + ' submissions in ' + range.fromDate + '..' + range.toDate + ' (UTC). Widen the window with --days or --from/--to.');
        }
        const total = parseTotalResults(xml);
        if (total > entries.length) {
            log.warn('Window ' + range.fromDate + '..' + range.toDate + ' holds ' + total + ' matches; showing the newest ' + entries.length + '. Raise --limit (max 200) to see more.');
        }
        return entries.map((e) => ({
            id: e.id,
            title: e.title,
            authors: e.authors,
            published: e.published,
            primary_category: e.primary_category,
            url: e.url,
        }));
    },
});
