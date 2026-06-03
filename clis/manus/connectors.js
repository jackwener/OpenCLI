import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { MANUS_DOMAIN, ensureOnManus, MANUS_API_CALL_JS } from './_utils.js';

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
        await ensureOnManus(page);
        const limit = kwargs?.limit || 50;

        const data = await page.evaluate(`(async () => {
            ${MANUS_API_CALL_JS}
            return callManusAPI('connectors.v1.ConnectorsService/ListConnectors', {});
        })()`);

        const connectors = data?.connectors || [];

        if (!connectors.length) {
            throw new EmptyResultError('manus connectors', 'No connectors found.');
        }

        return connectors.slice(0, limit).map((c) => ({
            UID: c.uid || '—',
            Name: c.name || '—',
            Brief: (c.brief || '—').slice(0, 60),
        }));
    },
});