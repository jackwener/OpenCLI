import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const sidebarCommand = cli({
  site: 'notion',
  name: 'sidebar',
  description: 'List pages and databases from the Notion sidebar',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Index', 'Title'],
  func: async (page: IPage) => {
    const items = await page.evaluate(`
      (function() {
        const results = [];
        // Notion sidebar items
        const selectors = [
          '[class*="sidebar"] [role="treeitem"]',
          '[class*="sidebar"] a',
          '.notion-sidebar [role="button"]',
          'nav [role="treeitem"]',
        ];
        
        for (const sel of selectors) {
          const nodes = document.querySelectorAll(sel);
          if (nodes.length > 0) {
            nodes.forEach((n, i) => {
              const text = (n.textContent || '').trim().substring(0, 100);
              if (text && text.length > 1) results.push({ Index: i + 1, Title: text });
            });
            break;
          }
        }
        return results;
      })()
    `);

    if (items.length === 0) {
      return [{ Index: 0, Title: 'No sidebar items found. Toggle the sidebar first.' }];
    }
    return items;
  },
});
