import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
    DRIBBBLE_HOST,
    DRIBBBLE_ORIGIN,
    extractShotRows,
    normalizeLimit,
    requireDesigner,
    requireRows,
    runBrowserTask,
} from './utils.js';

const PORTFOLIO_TYPES = ['work', 'likes'];

function normalizePortfolioType(value) {
    const type = String(value ?? 'work').trim().toLowerCase();
    if (!PORTFOLIO_TYPES.includes(type)) {
        throw new ArgumentError(`type must be one of: ${PORTFOLIO_TYPES.join(', ')}`);
    }
    return type;
}

cli({
    site: 'dribbble',
    name: 'portfolio',
    description: 'List a Dribbble designer\'s published or liked shots',
    domain: DRIBBBLE_HOST,
    strategy: Strategy.UI,
    access: 'read',
    browser: true,
    args: [
        { name: 'designer', positional: true, required: true, help: 'Dribbble username or profile slug' },
        { name: 'type', type: 'string', default: 'work', choices: PORTFOLIO_TYPES, help: 'Portfolio type: work or likes' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of shots (max 30)' },
    ],
    columns: ['rank', 'id', 'title', 'designer', 'likes', 'views', 'imageUrl', 'url'],
    func: async (page, args) => {
        const designer = requireDesigner(args.designer);
        const type = normalizePortfolioType(args.type);
        const limit = normalizeLimit(args.limit, 20, 30);
        const suffix = type === 'work' ? 'shots' : 'likes';
        return runBrowserTask('Dribbble portfolio extraction', async () => {
            await page.goto(`${DRIBBBLE_ORIGIN}/${encodeURIComponent(designer)}/${suffix}`);
            await page.wait(5);
            const payload = await page.evaluate(extractShotRows, limit);
            return requireRows(payload, 'dribbble portfolio')
                .map((row) => ({
                    ...row,
                    designer: row.designer || (type === 'work' ? designer : ''),
                }));
        });
    },
});
