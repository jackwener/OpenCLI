import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
    site: 'zlibrary-app',
    name: 'status',
    access: 'read',
    description: 'Check the active CDP connection to the Z-Library Desktop app',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        {
            name: 'url',
            type: 'boolean',
            help: 'Show raw URL even if non-http (e.g. electron://)',
        },
    ],
    columns: ['Status', 'Url', 'Title', 'Version'],
    func: async (page, kwargs) => {
        const url = await page.evaluate('window.location.href');
        const title = await page.evaluate('document.title');
        // Attempt to extract app version from the renderer
        const version = await page.evaluate(`
            (() => {
                const meta = document.querySelector('meta[name="app-version"]');
                if (meta) return meta.getAttribute('content');
                const el = document.querySelector('[class*="version"], [id*="version"]');
                return el ? el.textContent.trim() : '';
            })()
        `);

        // Sanitize non-http(s) URLs (oracle finding #6)
        // Default: show http(s) URLs as-is, show non-http as (non-http)
        const showRawUrl = !!kwargs.url;
        let displayUrl = url || '';
        if (!showRawUrl && displayUrl) {
            try {
                const parsed = new URL(displayUrl);
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                    displayUrl = '(non-http)';
                }
            } catch {
                displayUrl = '(non-http)';
            }
        }

        return [{
            Status: 'Connected',
            Url: displayUrl || '(empty)',
            Title: title || 'Z-Library Desktop',
            Version: version || '',
        }];
    },
});
