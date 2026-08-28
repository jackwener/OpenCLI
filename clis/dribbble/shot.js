import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import {
    DRIBBBLE_HOST,
    DRIBBBLE_ORIGIN,
    extractShotRows,
    hasDribbbleSessionCookie,
    normalizeLimit,
    requireQuery,
    requireRows,
    runBrowserTask,
} from './utils.js';

const SHOT_SORT_OPTIONS = ['following', 'popular', 'recent'];

function normalizeShotSort(value) {
    const sort = String(value ?? 'popular').trim().toLowerCase();
    if (!SHOT_SORT_OPTIONS.includes(sort)) {
        throw new ArgumentError(`sort must be one of: ${SHOT_SORT_OPTIONS.join(', ')}`);
    }
    return sort;
}

cli({
    site: 'dribbble',
    name: 'shot',
    description: 'Search public Dribbble shots by keyword',
    domain: DRIBBBLE_HOST,
    strategy: Strategy.UI,
    access: 'read',
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        {
            name: 'sort',
            type: 'string',
            default: 'popular',
            choices: SHOT_SORT_OPTIONS,
            help: 'Sort order: following, popular, or recent (New & Noteworthy)',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of shots (max 30)' },
    ],
    columns: ['rank', 'id', 'title', 'designer', 'likes', 'views', 'imageUrl', 'url'],
    func: async (page, args) => {
        const query = requireQuery(args.query);
        const limit = normalizeLimit(args.limit, 20, 30);
        const sort = normalizeShotSort(args.sort);
        if (sort === 'following' && !await hasDribbbleSessionCookie(page)) {
            throw new AuthRequiredError(DRIBBBLE_HOST, 'Following search requires a signed-in Dribbble browser session');
        }
        const url = new URL(`${DRIBBBLE_ORIGIN}/search/shots/${sort}`);
        url.searchParams.set('q', query);
        return runBrowserTask('Dribbble shot search', async () => {
            await page.goto(url.href);
            await page.wait(5);
            const payload = await page.evaluate(extractShotRows, limit);
            return requireRows(payload, 'dribbble shot');
        });
    },
});
