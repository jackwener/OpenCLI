import { cli, Strategy } from '../../registry.js';
import { SelectorError } from '../../errors.js';
import type { IPage } from '../../types.js';

export const askCommand = cli({
  site: 'dory',
  name: 'ask',
  description: 'Send a message and wait for the AI response (send + wait + read)',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'text', required: true, positional: true, help: 'Message to send' },
    { name: 'timeout', required: false, help: 'Max seconds to wait for response (default: 60)', default: '60' },
  ],
  columns: ['Role', 'Text'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;
    const timeout = parseInt(kwargs.timeout as string, 10) || 60;

    // Count current assistant messages before sending
    const beforeCount = await page.evaluate(`
      (function() {
        return document.querySelectorAll('[role="log"] .is-assistant').length;
      })()
    `);

    // Inject into React-controlled textarea and submit
    const injected = await page.evaluate(`
      (function(text) {
        const textarea = document.querySelector('textarea[name="message"]') || document.querySelector('textarea');
        if (!textarea) return false;
        textarea.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(textarea, text);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })(${JSON.stringify(text)})
    `);

    if (!injected) throw new SelectorError('Dory chat textarea');

    await page.wait(0.3);
    await page.pressKey('Enter');

    // Poll for new assistant message and wait for it to stabilise
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
        // Wait for streaming to finish: text must be stable across two polls
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
