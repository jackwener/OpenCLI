import { cli, Strategy } from '@jackwener/opencli/registry';
export const statusCommand = cli({
    site: 'doubao-app',
    name: 'status',
    description: 'Check CDP connection to Doubao desktop app',
    domain: 'doubao-app',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status', 'Url', 'Title'],
    func: async (page) => {
        const url = await page.evaluate('window.location.href');
        const title = await page.evaluate('document.title');
        return [{ Status: 'Connected', Url: url, Title: title }];
    },
});
