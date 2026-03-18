import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const favoritesCommand = cli({
  site: 'notion',
  name: 'favorites',
  description: 'List pages from the Notion Favorites section in the sidebar',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Index', 'Title', 'Icon'],
  func: async (page: IPage) => {
    const items = await page.evaluate(`
      (function() {
        const results = [];

        // Strategy 1: Find the "Favorites" header and collect its sibling tree items
        const allHeaders = document.querySelectorAll(
          '[class*="sidebar"] [role="heading"], [class*="sidebar"] [class*="sectionHeader"], [class*="sidebar"] [class*="header"]'
        );

        let favSection = null;
        for (const h of allHeaders) {
          const text = (h.textContent || '').trim().toLowerCase();
          if (text === 'favorites' || text === '收藏' || text === '收藏夹') {
            favSection = h;
            break;
          }
        }

        if (favSection) {
          // Walk up to find the section container, then get all tree items
          let container = favSection.closest('[role="group"], [class*="section"], [class*="favorites"]');
          if (!container) container = favSection.parentElement;
          if (container) {
            const treeItems = container.querySelectorAll('[role="treeitem"], [role="button"], a[href]');
            treeItems.forEach((item, i) => {
              const text = (item.textContent || '').trim().substring(0, 120);
              // Skip the header itself
              if (text && text.length > 1 && !text.toLowerCase().match(/^(favorites|收藏夹?)$/)) {
                // Try to extract emoji/icon
                const iconEl = item.querySelector('[class*="icon"], [class*="emoji"], [role="img"]');
                const icon = iconEl ? (iconEl.textContent || iconEl.getAttribute('aria-label') || '').trim() : '';
                results.push({ Index: results.length + 1, Title: text, Icon: icon || '📄' });
              }
            });
          }
        }

        // Strategy 2: Try data attributes or direct class-based selectors
        if (results.length === 0) {
          const favContainers = document.querySelectorAll(
            '[class*="favorite"], [data-testid*="favorite"], [class*="Favorite"]'
          );
          for (const container of favContainers) {
            const items = container.querySelectorAll('[role="treeitem"], [role="button"], a');
            items.forEach((item, i) => {
              const text = (item.textContent || '').trim().substring(0, 120);
              if (text && text.length > 1) {
                const iconEl = item.querySelector('[class*="icon"], [class*="emoji"], [role="img"]');
                const icon = iconEl ? (iconEl.textContent || iconEl.getAttribute('aria-label') || '').trim() : '';
                results.push({ Index: results.length + 1, Title: text, Icon: icon || '📄' });
              }
            });
            if (results.length > 0) break;
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
