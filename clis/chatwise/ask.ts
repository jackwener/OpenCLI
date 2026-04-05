import { cli, Strategy } from '@jackwener/opencli/registry';
import { SelectorError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';

export const askCommand = cli({
  site: 'chatwise',
  name: 'ask',
  description: 'Send a prompt and wait for the AI response (send + wait + read)',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
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
        const msgs = document.querySelectorAll('[data-message-id], [class*="message"], [class*="bubble"]');
        return msgs.length;
      })()
    `);

    // Send message
    const injected = await page.evaluate(`
      (function(text) {
        let composer = document.querySelector('textarea');
        if (!composer) {
          const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
          composer = editables.length > 0 ? editables[editables.length - 1] : null;
        }
        if (!composer) return false;
        composer.focus();
        if (composer.tagName === 'TEXTAREA') {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(composer, text);
          composer.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          document.execCommand('insertText', false, text);
        }
        return true;
      })(${JSON.stringify(text)})
    `);
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
          const msgs = document.querySelectorAll('[data-message-id], [class*="message"], [class*="bubble"]');
          if (msgs.length <= prevLen) return null;
          const last = msgs[msgs.length - 1];
          const text = last.innerText || last.textContent;
          return text ? text.trim() : null;
        })(${beforeLen})
      `);

      if (result) {
        response = result;
        break;
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
