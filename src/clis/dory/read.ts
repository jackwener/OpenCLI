import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { ensureChatbotPage, resolveConnectionId } from './_shared.js';

export const readCommand = cli({
  site: 'dory',
  name: 'read',
  description: 'Read the full conversation thread from the active Dory chat',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'connection', required: false, help: 'Connection name or ID to navigate to before reading' },
  ],
  columns: ['Role', 'Text'],
  func: async (page: IPage, kwargs: any) => {
    const rawConn = kwargs.connection as string | undefined;
    const connectionId = rawConn ? await resolveConnectionId(page, rawConn) : undefined;

    await ensureChatbotPage(page, connectionId);

    const messages = await page.evaluate(`
      (function() {
        const log = document.querySelector('[role="log"]');
        if (!log) return [];

        const results = [];
        const wrappers = log.querySelectorAll('.is-user, .is-assistant');
        wrappers.forEach(function(el) {
          const isUser = el.classList.contains('is-user');
          const text = (el.innerText || el.textContent || '').trim();
          if (text) results.push({ Role: isUser ? 'User' : 'Assistant', Text: text });
        });

        if (results.length === 0) {
          const text = (log.innerText || log.textContent || '').trim();
          if (text) results.push({ Role: 'Thread', Text: text });
        }

        return results;
      })()
    `);

    if (!messages || messages.length === 0) {
      return [{ Role: 'System', Text: 'No messages found.' }];
    }

    return messages;
  },
});
