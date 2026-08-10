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
        // Clear any previous Discord search result view so a new query cannot
        // accidentally scrape stale rows while the next search is loading.
        await page.pressKey('Escape');
        await page.wait(0.2);
        // Open search with Cmd+F
        const isMac = process.platform === 'darwin';
        await page.pressKey(isMac ? 'Meta+F' : 'Control+F');
        await page.wait(0.5);
        // Discord currently renders search with Draft.js. Selecting the whole
        // contenteditable before insertion updates the DOM but not Draft.js's
        // internal state, so focus the freshly cleared editor and insert text
        // through native browser input instead.
        const searchSelector = '[role="combobox"][contenteditable="true"][aria-label*="Search"], input[aria-label*="Search"], [class*="searchBar"] input, input[placeholder*="Search"]';
        const searchReady = await page.evaluate(`
      (function(selector) {
        const editor = document.querySelector(selector);
        if (!editor) return false;
        editor.focus();
        if (editor.isContentEditable) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        return document.activeElement === editor && !(editor.textContent || editor.value || '');
      })(${JSON.stringify(searchSelector)})
        `);
        if (!searchReady)
            throw new CommandExecutionError('Discord search input was not ready for a new query.');
        if (typeof page.nativeType !== 'function' || typeof page.cdp !== 'function') {
            throw new CommandExecutionError('Discord search requires native browser input support.');
        }
        await page.nativeType(query);
        const retainedQuery = await page.evaluate(`document.activeElement?.textContent || document.activeElement?.value || ''`);
        if (retainedQuery !== query) {
            throw new CommandExecutionError(`Discord search input did not retain query "${query}".`);
        }
        const enterEvent = {
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
        };
        await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...enterEvent });
        await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...enterEvent });
        // DOM-stability waits can return before Discord's asynchronous search
        // response arrives. Wait for the result root instead.
        await page.wait({ selector: '#search-results', timeout: 10 }).catch(() => undefined);
        // Scrape search results
        const searchState = await page.evaluate(`
      (function() {
        const items = [];
        let resultNodes = document.querySelectorAll('#search-results [id^="search-results-"]');
        if (resultNodes.length === 0) {
          resultNodes = document.querySelectorAll('[class*="searchResult_"]');
        }
        
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
