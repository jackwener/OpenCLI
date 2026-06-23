import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
export const searchCommand = cli({
    site: 'discord-app',
    name: 'search',
    access: 'read',
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
        const searchState = await page.evaluate(`
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
        
        const bodyText = document.body?.innerText || document.body?.textContent || '';
        const empty = /no results|no messages match|没有结果|无结果/i.test(bodyText);
        return { items, empty };
      })()
    `);
        if (!searchState || !Array.isArray(searchState.items)) {
            throw new CommandExecutionError('Discord search returned malformed browser payload.');
        }
        const results = searchState.items;
        // Close search
        await page.pressKey('Escape');
        if (results.length === 0) {
            if (!searchState.empty) {
                throw new CommandExecutionError('Discord search result selector returned no rows and no explicit empty-state marker.');
            }
            throw new EmptyResultError('discord-app search', `No results for "${query}".`);
        }
        return results;
    },
});
