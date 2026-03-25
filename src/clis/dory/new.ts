import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const newCommand = cli({
  site: 'dory',
  name: 'new',
  description: 'Create a new Dory chat session',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Status'],
  func: async (page: IPage) => {
    // Try to find and click the "New" session button in the sidebar
    const clicked = await page.evaluate(`
      (function() {
        // Look for a button/link that creates a new session
        // The ChatSessionSidebar renders an onCreate button — find it by common aria labels or text
        const candidates = Array.from(document.querySelectorAll('button, a[role="button"]'));
        const newBtn = candidates.find(function(el) {
          const text = (el.textContent || el.innerText || '').trim().toLowerCase();
          const label = (el.getAttribute('aria-label') || '').toLowerCase();
          return text === 'new' || text === 'new chat' || label.includes('new') || label.includes('create');
        });
        if (newBtn) {
          newBtn.click();
          return true;
        }
        return false;
      })()
    `);

    if (!clicked) {
      // Fallback: Cmd/Ctrl+K is a common new-chat shortcut in web chat apps
      const isMac = process.platform === 'darwin';
      await page.pressKey(isMac ? 'Meta+K' : 'Control+K');
    }

    await page.wait(1);
    return [{ Status: 'Success' }];
  },
});
