import { cli, Strategy } from '@jackwener/opencli/registry';
import { SelectorError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';

export const sendCommand = cli({
  site: 'chatwise',
  name: 'send',
  description: 'Send a message to the active ChatWise conversation',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'text', required: true, positional: true, help: 'Message to send' }],
  columns: ['Status', 'InjectedText'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;

    const injected = await page.evaluate(`
      (function(text) {
        // ChatWise input can be textarea or contenteditable
        let composer = document.querySelector('textarea');
        if (!composer) {
          const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
          composer = editables.length > 0 ? editables[editables.length - 1] : null;
        }

        if (!composer) return false;

        composer.focus();
        
        if (composer.tagName === 'TEXTAREA') {
          // For textarea, set value and dispatch input event
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeInputValueSetter.call(composer, text);
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

    return [
      {
        Status: 'Success',
        InjectedText: text,
      },
    ];
  },
});
