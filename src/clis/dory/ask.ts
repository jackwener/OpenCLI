import { cli, Strategy } from '../../registry.js';
import { SelectorError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { ensureChatbotPage, injectChatText, resolveConnectionId } from './_shared.js';

export const askCommand = cli({
  site: 'dory',
  name: 'ask',
  description: 'Send a message and wait for the AI response (send + wait + read)',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'text', required: true, positional: true, help: 'Message to send' },
    { name: 'connection', required: false, help: 'Connection name or ID to navigate to before sending' },
    { name: 'timeout', required: false, help: 'Max seconds to wait for response (default: 60)', default: '60' },
  ],
  columns: ['Role', 'Text'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;
    const rawConn = kwargs.connection as string | undefined;
    const connectionId = rawConn ? await resolveConnectionId(page, rawConn) : undefined;
    const timeout = parseInt(kwargs.timeout as string, 10) || 60;

    await ensureChatbotPage(page, connectionId);

    const beforeCount = await page.evaluate(`
      (function() {
        return document.querySelectorAll('[role="log"] .is-assistant').length;
      })()
    `);

    const injected = await injectChatText(page, text);
    if (!injected) throw new SelectorError('Dory chat textarea');

    await page.wait(0.3);
    await page.pressKey('Enter');

    const pollInterval = 2;
    const maxPolls = Math.ceil(timeout / pollInterval);
    let response = '';
    let lastText = '';

    for (let i = 0; i < maxPolls; i++) {
      await page.wait(pollInterval);

      const result = await page.evaluate(`
        (function(prevCount) {
          const msgs = document.querySelectorAll('[role="log"] .is-assistant');
          if (msgs.length <= prevCount) return null;
          const last = msgs[msgs.length - 1];
          return (last.innerText || last.textContent || '').trim();
        })(${beforeCount})
      `);

      if (result) {
        if (result === lastText) {
          response = result;
          break;
        }
        lastText = result;
      }
    }

    if (!response && lastText) response = lastText;

    if (!response) {
      return [
        { Role: 'User', Text: text },
        { Role: 'System', Text: `No response within ${timeout}s. The AI may still be generating.` },
      ];
    }

    return [
      { Role: 'User', Text: text },
      { Role: 'Assistant', Text: response },
    ];
  },
});
