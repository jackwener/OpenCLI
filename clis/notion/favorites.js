import { cli, Strategy } from '@jackwener/opencli/registry';
export const favoritesCommand = cli({
    site: 'notion',
    name: 'favorites',
    description: 'List pages from the Notion Favorites section in the sidebar',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Title', 'Icon'],
    func: async (page) => {
        const items = await page.evaluate(`
      (function() {
        const results = [];

        // Strategy 1: Use Notion's own class 'notion-outliner-bookmarks-header-container'
        const headerContainer = document.querySelector('.notion-outliner-bookmarks-header-container');
        if (headerContainer) {
          // Walk up to the section parent that wraps header + items
          let section = headerContainer.parentElement;
          if (section && section.children.length === 1) section = section.parentElement;

          if (section) {
            const treeItems = section.querySelectorAll('[role="treeitem"]');
            treeItems.forEach((item) => {
              // Title text is in a div.notranslate sibling of the icon area
              const titleEl = item.querySelector('div.notranslate:not(.notion-record-icon)');
              const title = titleEl
                ? titleEl.textContent.trim()
                : (item.textContent || '').trim().substring(0, 80);

              // Icon/emoji is in the notion-record-icon element
              const iconEl = item.querySelector('.notion-record-icon');
              const icon = iconEl ? iconEl.textContent.trim().substring(0, 4) : '';

              if (title && title.length > 0) {
                results.push({ Index: results.length + 1, Title: title, Icon: icon || '📄' });
              }
            });
          }
        }

        // Strategy 2: Fallback — find "Favorites" text node and walk DOM
        if (results.length === 0) {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
          let node;
          let favEl = null;
          while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text === 'Favorites' || text === '收藏' || text === '收藏夹') {
              favEl = node.parentElement;
              break;
            }
          }

          if (favEl) {
            let section = favEl;
            for (let i = 0; i < 6; i++) {
              const p = section.parentElement;
              if (!p || p === document.body) break;
              const treeItems = p.querySelectorAll(':scope > [role="treeitem"]');
              if (treeItems.length > 0) { section = p; break; }
              section = p;
            }

            const treeItems = section.querySelectorAll('[role="treeitem"]');
            treeItems.forEach((item) => {
              const text = (item.textContent || '').trim().substring(0, 120);
              if (text && text.length > 1 && !text.match(/^(Favorites|收藏夹?)$/)) {
                results.push({ Index: results.length + 1, Title: text, Icon: '📄' });
              }
            });
          }
        }

        return results;
      })()
    `);
        if (items.length === 0) {
            return [{ Index: 0, Title: 'No favorites found. Make sure sidebar is visible and you have favorites.', Icon: '⚠️' }];
        }
        return items;
    },
});
