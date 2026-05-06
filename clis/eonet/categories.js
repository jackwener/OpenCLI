// eonet categories — list of all event categories with id and description.
//
// Endpoint: GET /categories
// Categories are stable over time — useful as a discovery command before
// filtering `events --category <id>`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { eonetFetch, EONET_BASE } from './utils.js';

cli({
    site: 'eonet',
    name: 'categories',
    access: 'read',
    description: 'List EONET event categories (ids round-trip to events --category)',
    domain: 'gsfc.nasa.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['rank', 'id', 'title', 'description', 'link'],
    func: async () => {
        const url = `${EONET_BASE}/categories`;
        const body = await eonetFetch(url, 'eonet categories');
        const list = Array.isArray(body?.categories) ? body.categories : [];
        if (!list.length) {
            throw new EmptyResultError('eonet categories', 'eonet.gsfc.nasa.gov returned no categories.');
        }
        return list.map((c, i) => ({
            rank: i + 1,
            id: c?.id ?? null,
            title: c?.title ?? null,
            description: c?.description ?? null,
            link: c?.link ?? null,
        }));
    },
});
