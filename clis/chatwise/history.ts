import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

export const historyCommand = cli({
  site: 'chatwise',
  name: 'history',
  description: 'List conversation history in ChatWise sidebar',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Index', 'Title'],
  func: async (page: IPage) => {
    const items = await page.evaluate(`
      (function() {
        const results = [];
        const selectors = [
          '[class*="sidebar"] [class*="item"]',
          '[class*="conversation-list"] a',
          '[class*="chat-list"] > *',
          'nav a',
          'aside a',
          '[role="listbox"] [role="option"]',
        ];
        
        for (const sel of selectors) {
          const nodes = document.querySelectorAll(sel);
          if (nodes.length > 0) {
            nodes.forEach((n, i) => {
              const text = (n.textContent || '').trim().substring(0, 100);
              if (text) results.push({ Index: i + 1, Title: text });
            });
            break;
          }
        }
        
        return results;
      })()
    `);

    if (items.length === 0) {
      return [{ Index: 0, Title: 'No history found. Ensure the sidebar is visible.' }];
    }

    const dateHeaders = /^(today|yesterday|last week|last month|last year|this week|this month|older|previous \d+ days|\d+ days ago)$/i;
    const numericOnly = /^[\d\s]+$/;
    const modelPath = /^[\w.-]+\/[\w.-]/;
    const seen = new Set<string>();
    const deduped = items.filter((item: { Index: number; Title: string }) => {
      const t = item.Title.trim();
      if (dateHeaders.test(t)) return false;
      if (numericOnly.test(t)) return false;
      if (modelPath.test(t)) return false;
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    }).map((item: { Index: number; Title: string }, i: number) => ({ Index: i + 1, Title: item.Title }));

    return deduped;
  },
});
