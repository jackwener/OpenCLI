import { cli, Strategy } from '@jackwener/opencli/registry';
export const statusCommand = cli({
    site: 'antigravity',
    name: 'status',
    description: 'Check Antigravity CDP connection and get current page state',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['status', 'url', 'title'],
    func: async (page) => {
        return {
            status: 'Connected',
            url: await page.evaluate('window.location.href'),
            title: await page.evaluate('document.title'),
        };
    },
});
