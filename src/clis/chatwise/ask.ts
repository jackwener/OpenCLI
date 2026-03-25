import { cli, Strategy } from '../../registry.js';
import { SelectorError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { chatwiseRequiredEnv } from './shared.js';
import { buildChatwiseInjectTextJs } from './utils.js';

const MESSAGE_WRAPPER_SELECTOR = '[class*="group/message"]';

export const askCommand = cli({
  site: 'chatwise',
  name: 'ask',
  description: 'Send a prompt and wait for the AI response (send + wait + read)',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  requiredEnv: chatwiseRequiredEnv,
  args: [
    { name: 'text', required: true, positional: true, help: 'Prompt to send' },
    { name: 'timeout', required: false, help: 'Max seconds to wait (default: 30)', default: '30' },
  ],
  columns: ['Role', 'Text'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;
    const timeout = parseInt(kwargs.timeout as string, 10) || 30;

    // Snapshot content length
    const beforeLen = await page.evaluate(`
      (function() {
        const msgs = document.querySelectorAll(${JSON.stringify(MESSAGE_WRAPPER_SELECTOR)});
        return msgs.length;
      })()
    `);

    // Send message
    const injected = await page.evaluate(buildChatwiseInjectTextJs(text));
    if (!injected) throw new SelectorError('ChatWise input element');

    await page.wait(0.5);
    await page.pressKey('Enter');

    // Poll for response
    const pollInterval = 2;
    const maxPolls = Math.ceil(timeout / pollInterval);
    let response = '';

    for (let i = 0; i < maxPolls; i++) {
      await page.wait(pollInterval);

      const result = await page.evaluate(`
        (function(prevLen) {
          const msgs = Array.from(document.querySelectorAll(${JSON.stringify(MESSAGE_WRAPPER_SELECTOR)}))
            .map(node => (node.innerText || node.textContent || '').trim())
            .filter(Boolean);
          if (msgs.length <= prevLen) return null;
          const fresh = msgs.slice(prevLen).filter(text => text !== ${JSON.stringify(text)});
          if (fresh.length === 0) return null;
          return fresh[fresh.length - 1];
        })(${beforeLen})
      `);

      if (result) {
        const next = String(result).trim();
        if (next === response) {
          break;
        }
        response = next;
      }
    }

    if (!response) {
      return [
        { Role: 'User', Text: text },
        { Role: 'System', Text: `No response within ${timeout}s.` },
      ];
    }

    return [
      { Role: 'User', Text: text },
      { Role: 'Assistant', Text: response },
    ];
  },
});
