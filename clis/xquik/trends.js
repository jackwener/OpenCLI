import { cli, Strategy } from '@jackwener/opencli/registry';
import { XQUIK_BASE, addParam, requireBoundedInt, xquikFetch } from './utils.js';

cli({
    site: 'xquik',
    name: 'trends',
    access: 'read',
    description: 'Get X/Twitter trending topics by WOEID through Xquik.',
    domain: 'xquik.com',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'woeid', type: 'int', default: 1, help: 'Region WOEID, for example 1 worldwide or 23424977 US' },
        { name: 'count', type: 'int', default: 30, help: 'Number of trends to return (1-50)' },
    ],
    columns: ['rank', 'name', 'description', 'query', 'woeid'],
    func: async (args) => {
        const url = new URL('/api/v1/x/trends', XQUIK_BASE);
        addParam(url, 'woeid', requireBoundedInt(args.woeid, 1, Number.MAX_SAFE_INTEGER, 'woeid'));
        addParam(url, 'count', requireBoundedInt(args.count, 30, 50, 'count'));
        const body = await xquikFetch(url, 'xquik trends');
        const trends = Array.isArray(body?.trends) ? body.trends : [];
        return trends.map((trend, index) => ({
            rank: trend?.rank ?? index + 1,
            name: String(trend?.name ?? ''),
            description: String(trend?.description ?? ''),
            query: String(trend?.query ?? ''),
            woeid: body?.woeid ?? args.woeid ?? 1,
        }));
    },
});
