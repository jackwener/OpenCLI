import { cli, Strategy } from '@jackwener/opencli/registry';
export const statusCommand = cli({
    site: 'notion',
    name: 'status',
    access: 'read',
    description: 'Check active CDP connection to Notion Desktop',
    domain: 'localhost',
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
