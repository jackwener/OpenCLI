import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildScysHomeEssenceUrl } from './common.js';
import { extractScysFeed } from './extractors.js';
cli({
    site: 'scys',
    name: 'feed',
    description: 'Extract SCYS feed cards (home essence or profile posts)',
    domain: 'scys.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'url', positional: true, default: buildScysHomeEssenceUrl(), help: 'Feed URL (default: home essence feed)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max number of cards' },
        { name: 'wait', type: 'int', default: 3, help: 'Seconds to wait after page load' },
    ],
    columns: ['rank', 'author', 'time', 'flags', 'title', 'summary', 'tags', 'interactions_display', 'image_count', 'url'],
    func: async (page, kwargs) => {
        return extractScysFeed(page, String(kwargs.url ?? buildScysHomeEssenceUrl()), {
            waitSeconds: Number(kwargs.wait ?? 3),
            limit: Number(kwargs.limit ?? 20),
        });
    },
});
