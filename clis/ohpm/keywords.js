// ohpm keywords — current hot search terms shown on the OHPM home page.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { OHPM_API, normalizeText, ohpmFetch } from './utils.js';

cli({
    site: 'ohpm',
    name: 'keywords',
    access: 'read',
    description: 'List hot OHPM search keywords',
    domain: 'ohpm.openharmony.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['rank', 'keyword'],
    func: async () => {
        const body = await ohpmFetch(`${OHPM_API}/v1/frequency`, 'ohpm keywords');
        const list = Array.isArray(body?.body) ? body.body : [];
        if (!list.length) {
            throw new EmptyResultError('ohpm keywords', 'OHPM returned no hot keywords.');
        }
        return list.map((keyword, i) => ({
            rank: i + 1,
            keyword: normalizeText(keyword),
        }));
    },
});
