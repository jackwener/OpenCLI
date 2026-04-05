import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';

export const historyCommand = cli({
  site: 'cursor',
  name: 'history',
  description: 'List recent chat sessions from the Cursor sidebar',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Index', 'Title'],
  func: async (page: IPage) => {
    const items = await page.evaluate(`
      (function() {
        const results = [];
        // Cursor chat history lives in sidebar items
        const entries = document.querySelectorAll('.agent-sidebar-list-item, [data-testid="chat-history-item"], .chat-history-item, .tree-item');
        
        entries.forEach((item, i) => {
          const title = (item.textContent || item.innerText || '').trim().substring(0, 100);
          if (title) results.push({ Index: i + 1, Title: title });
        });
        
        // Fallback: try to find sidebar text items
        if (results.length === 0) {
          const sidebar = document.querySelector('.sidebar, [class*="sidebar"], .agent-sidebar, .side-bar-container');
          if (sidebar) {
            const links = sidebar.querySelectorAll('a, [role="treeitem"], [role="option"]');
            links.forEach((link, i) => {
              const text = (link.textContent || '').trim().substring(0, 100);
              if (text) results.push({ Index: i + 1, Title: text });
            });
          }
        }
        
        return results;
      })()
    `);

    if (items.length === 0) {
      return [{ Index: 0, Title: 'No chat history found. Open the AI sidebar first.' }];
    }

    return items;
  },
});
