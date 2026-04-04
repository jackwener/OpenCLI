import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

export const historyCommand = cli({
  site: 'codex',
  name: 'history',
  description: 'List recent conversation threads in Codex',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Index', 'Title'],
  func: async (page: IPage) => {
    const items = await page.evaluate(`
      (function() {
        const results = [];
        // Codex thread list items
        const entries = document.querySelectorAll('[data-testid*="thread"], [class*="thread-list"] a, [role="listbox"] [role="option"]');
        
        entries.forEach((item, i) => {
          const title = (item.textContent || item.innerText || '').trim().substring(0, 100);
          if (title) results.push({ Index: i + 1, Title: title });
        });
        
        // Fallback: sidebar/nav links
        if (results.length === 0) {
          const nav = document.querySelector('nav, [role="navigation"], aside');
          if (nav) {
            const links = nav.querySelectorAll('a, button');
            links.forEach((link, i) => {
              const text = (link.textContent || '').trim().substring(0, 100);
              if (text && text.length > 3) results.push({ Index: i + 1, Title: text });
            });
          }
        }
        
        return results;
      })()
    `);

    if (items.length === 0) {
      return [{ Index: 0, Title: 'No threads found. Try opening the thread list first.' }];
    }

    return items;
  },
});
