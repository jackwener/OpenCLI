import { cli, Strategy } from '../../registry.js';
import { SelectorError } from '../../errors.js';
import type { IPage } from '../../types.js';

export const sendCommand = cli({
  site: 'codex',
  name: 'send',
  description: 'Send text/commands to the Codex AI composer',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'text', required: true, positional: true, help: 'Text, command (e.g. /review), or skill (e.g. $imagegen)' }],
  columns: ['Status', 'InjectedText'],
  func: async (page: IPage, kwargs: any) => {
    const textToInsert = kwargs.text as string;

    const injected = await page.evaluate(`
      (function(text) {
        let composer = document.querySelector('textarea, [contenteditable="true"]');
        
        const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        if (editables.length > 0) {
           composer = editables[editables.length - 1];
        }

        if (!composer) return false;

        composer.focus();
        document.execCommand('insertText', false, text);
        return true;
      })(${JSON.stringify(textToInsert)})
    `);
    if (!injected) throw new SelectorError('Codex Composer input element');

    // Wait for the UI to register the input
    await page.wait(0.5);

    // Simulate Enter key to submit
    await page.pressKey('Enter');

    return [
      {
        Status: 'Success',
        InjectedText: textToInsert,
      },
    ];
  },
});
