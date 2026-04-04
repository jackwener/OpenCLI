import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

export const serversCommand = cli({
  site: 'discord-app',
  name: 'servers',
  description: 'List all Discord servers (guilds) in the sidebar',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Index', 'Server'],
  func: async (page: IPage) => {
    const servers = await page.evaluate(`
      (function() {
        const results = [];
        // Discord guild icons in the sidebar
        const items = document.querySelectorAll('[data-list-item-id*="guildsnav___"], [class*="listItem_"]');
        
        items.forEach((item, i) => {
          const nameAttr = item.querySelector('[data-dnd-name]');
          const ariaLabel = item.getAttribute('aria-label') || (item.querySelector('[aria-label]') || {}).getAttribute?.('aria-label');
          const name = nameAttr ? nameAttr.getAttribute('data-dnd-name') : (ariaLabel || (item.textContent || '').trim());
          
          if (name && name.length > 0) {
            results.push({ Index: i + 1, Server: name.substring(0, 80) });
          }
        });
        
        return results;
      })()
    `);

    if (servers.length === 0) {
      return [{ Index: 0, Server: 'No servers found' }];
    }
    return servers;
  },
});
