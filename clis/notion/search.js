import { cli, Strategy } from '@jackwener/opencli/registry';
export const searchCommand = cli({
    site: 'notion',
    name: 'search',
    description: 'Search pages and databases in Notion via Quick Find (Cmd+P)',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [{ name: 'query', required: true, positional: true, help: 'Search query' }],
    columns: ['Index', 'Title'],
    func: async (page, kwargs) => {
        const query = kwargs.query;
        // Open Quick Find
        const isMac = process.platform === 'darwin';
        await page.pressKey(isMac ? 'Meta+P' : 'Control+P');
        await page.wait(0.5);
        // Type the search query
        await page.evaluate(`
      (function(q) {
        const input = document.querySelector('input[placeholder*="Search"], input[type="text"]');
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, q);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })(${JSON.stringify(query)})
    `);
        await page.wait(1.5);
        // Scrape results
        const results = await page.evaluate(`
      (function() {
        const items = document.querySelectorAll('[role="option"], [class*="searchResult"], [class*="quick-find"] [role="button"]');
        return Array.from(items).slice(0, 20).map((item, i) => ({
          Index: i + 1,
          Title: (item.textContent || '').trim().substring(0, 120),
        }));
      })()
    `);
        // Close Quick Find
        await page.pressKey('Escape');
        if (results.length === 0) {
            return [{ Index: 0, Title: `No results for "${query}"` }];
        }
        return results;
    },
});
