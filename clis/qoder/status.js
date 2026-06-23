import { cli, Strategy } from '@jackwener/opencli/registry';
import { evaluateQoder } from './_utils.js';

cli({
    site: 'qoder',
    name: 'status',
    access: 'read',
    description: 'Check Qoder CDP connection and report the current renderer URL + title.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status', 'Url', 'Title'],
    func: async (page) => {
        return [{
            Status: 'Connected',
            Url: await evaluateQoder(page, 'window.location.href'),
            Title: await evaluateQoder(page, 'document.title'),
        }];
    },
});
