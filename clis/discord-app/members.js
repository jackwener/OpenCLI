import { cli, Strategy } from '@jackwener/opencli/registry';
export const membersCommand = cli({
    site: 'discord-app',
    name: 'members',
    description: 'List online members in the current Discord channel',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Name', 'Status'],
    func: async (page) => {
        const members = await page.evaluate(`
      (function() {
        const results = [];
        // Discord member list sidebar
        const items = document.querySelectorAll('[class*="member_"], [data-list-item-id*="members"]');
        
        items.forEach((item, i) => {
          const nameEl = item.querySelector('[class*="username_"], [class*="nameTag"]');
          const statusEl = item.querySelector('[class*="activity"], [class*="customStatus"]');
          
          const name = nameEl ? nameEl.textContent.trim() : (item.textContent || '').trim().substring(0, 50);
          const status = statusEl ? statusEl.textContent.trim() : '';
          
          if (name && name.length > 0) {
            results.push({ Index: i + 1, Name: name, Status: status || 'Online' });
          }
        });
        
        return results.slice(0, 50); // Limit to 50
      })()
    `);
        if (members.length === 0) {
            return [{ Index: 0, Name: 'No members visible', Status: 'Toggle member list first' }];
        }
        return members;
    },
});
