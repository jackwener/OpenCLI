import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractScysActivity } from './extractors.js';
cli({
    site: 'scys',
    name: 'activity',
    description: 'Extract SCYS activity landing page structure (tabs, stages, tasks)',
    domain: 'scys.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'url', required: true, positional: true, help: 'Activity landing URL: /activity/landing/:id' },
        { name: 'wait', type: 'int', default: 3, help: 'Seconds to wait after page load' },
    ],
    columns: ['title', 'subtitle', 'tabs', 'stages', 'url'],
    func: async (page, kwargs) => {
        return extractScysActivity(page, String(kwargs.url), {
            waitSeconds: Number(kwargs.wait ?? 3),
        });
    },
});
