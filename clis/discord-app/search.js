import { cli, Strategy } from '@jackwener/opencli/registry';
export const searchCommand = cli({
    site: 'discord-app',
    name: 'search',
    description: 'Search messages in the current Discord server/channel (Cmd+F)',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [{ name: 'query', required: true, positional: true, help: 'Search query' }],
    columns: ['Index', 'Author', 'Message'],
    func: async (page, kwargs) => {
        const query = kwargs.query;
        // Open search with Cmd+F
        const isMac = process.platform === 'darwin';
        await page.pressKey(isMac ? 'Meta+F' : 'Control+F');
        await page.wait(0.5);
        // Type query into search box
        await page.evaluate(`
      (function(q) {
        const input = document.querySelector('[aria-label*="Search"], [class*="searchBar"] input, [placeholder*="Search"]');
        if (!input) throw new Error('Search input not found');
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, q);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })(${JSON.stringify(query)})
    `);
        await page.pressKey('Enter');
        await page.wait(2);
        // Scrape search results
        const results = await page.evaluate(`
      (function() {
        const items = [];
        const resultNodes = document.querySelectorAll('[class*="searchResult_"], [id*="search-result"]');
        
        resultNodes.forEach((node, i) => {
          const author = node.querySelector('[class*="username"]')?.textContent?.trim() || '—';
          const content = node.querySelector('[id^="message-content-"], [class*="messageContent"]')?.textContent?.trim() || node.textContent?.trim();
          items.push({
            Index: i + 1,
            Author: author,
            Message: (content || '').substring(0, 200),
          });
        });
        
        return items;
      })()
    `);
        // Close search
        await page.pressKey('Escape');
        if (results.length === 0) {
            return [{ Index: 0, Author: 'System', Message: `No results for "${query}"` }];
        }
        return results;
    },
});
