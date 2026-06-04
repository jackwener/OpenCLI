import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { MANUS_DOMAIN, ensureOnManus, MANUS_API_CALL_JS, requireArray, requireObject, requireString, validatedLimit } from './_utils.js';

cli({
    site: 'manus',
    name: 'connectors',
    access: 'read',
    description: 'List available Manus connectors (integrations).',
    domain: MANUS_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: true,
    args: [
        { name: 'limit', type: 'int', default: 50, help: 'Max connectors to return' },
    ],
    columns: ['UID', 'Name', 'Brief'],
    func: async (page, kwargs) => {
        const limit = validatedLimit(kwargs?.limit, 50, 500);
        await ensureOnManus(page);

        const data = requireObject(await page.evaluate(`(async () => {
            ${MANUS_API_CALL_JS}
            return callManusAPI('connectors.v1.ConnectorsService/ListConnectors', {});
        })()`), 'connectors');

        const connectors = requireArray(data.connectors, 'connectors');

        if (!connectors.length) {
            throw new EmptyResultError('manus connectors', 'No connectors found.');
        }

        return connectors.slice(0, limit).map((c, index) => ({
            UID: requireString(c?.uid, `connector ${index + 1}`),
            Name: requireString(c?.name, `connector ${index + 1}`),
            Brief: (c.brief || '—').slice(0, 60),
        }));
    },
});
