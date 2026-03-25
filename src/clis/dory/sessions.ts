import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { ensureChatbotPage, resolveConnectionId } from './_shared.js';

export const sessionsCommand = cli({
  site: 'dory',
  name: 'sessions',
  description: 'List recent Dory chat sessions from the sidebar',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'connection', required: false, help: 'Connection name or ID to navigate to before listing sessions' },
  ],
  columns: ['Index', 'Title'],
  func: async (page: IPage, kwargs: any) => {
    const rawConn = kwargs.connection as string | undefined;
    const connectionId = rawConn ? await resolveConnectionId(page, rawConn) : undefined;
    await ensureChatbotPage(page, connectionId);
    const items = await page.evaluate(`
      (function() {
        const results = [];

        // ChatSessionSidebar renders session buttons inside an aside or sidebar panel.
        // Each session is a <button> with a truncated title text.
        const sidebar = document.querySelector('aside, [role="complementary"], [data-sidebar]');
        if (sidebar) {
          const btns = sidebar.querySelectorAll('button');
          btns.forEach(function(btn, i) {
            const text = (btn.textContent || btn.innerText || '').trim().substring(0, 120);
            // Skip icon-only or very short buttons (e.g. "+" or "...")
            if (text && text.length > 3) {
              results.push({ Index: i + 1, Title: text });
            }
          });
        }

        // Fallback: scan nav links
        if (results.length === 0) {
          const nav = document.querySelector('nav, [role="navigation"]');
          if (nav) {
            const links = nav.querySelectorAll('a, button');
            links.forEach(function(el, i) {
              const text = (el.textContent || '').trim().substring(0, 120);
              if (text && text.length > 3) results.push({ Index: i + 1, Title: text });
            });
          }
        }

        return results;
      })()
    `);

    if (!items || items.length === 0) {
      return [{ Index: 0, Title: 'No sessions found. Open the Dory chatbot sidebar first.' }];
    }

    return items;
  },
});
