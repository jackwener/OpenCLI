import { cli, Strategy } from '../../registry.js';
import { SelectorError } from '../../errors.js';
import type { IPage } from '../../types.js';

export const sendCommand = cli({
  site: 'dory',
  name: 'send',
  description: 'Send a message to the active Dory chat composer',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'text', required: true, positional: true, help: 'Message text to send' }],
  columns: ['Status', 'InjectedText'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;

    // Dory uses a React-controlled <textarea name="message">.
    // We must use the native value setter so React's synthetic event picks it up.
    const injected = await page.evaluate(`
      (function(text) {
        const textarea = document.querySelector('textarea[name="message"]') || document.querySelector('textarea');
        if (!textarea) return false;
        textarea.focus();

        // Trigger React's synthetic onChange by using the native value setter
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

    return [{ Status: 'Success', InjectedText: text }];
  },
});
