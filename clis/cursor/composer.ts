import { cli, Strategy } from '../../src/registry.js';
import { SelectorError } from '../../src/errors.js';
import type { IPage } from '../../src/types.js';

export const composerCommand = cli({
  site: 'cursor',
  name: 'composer',
  description: 'Send a prompt directly into Cursor Composer (Cmd+I shortcut)',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'text', required: true, positional: true, help: 'Text to send into Composer' }],
  columns: ['Status', 'InjectedText'],
  func: async (page: IPage, kwargs: any) => {
    const textToInsert = kwargs.text as string;

    // Open/Focus Composer via shortcut — always works regardless of current state
    await page.pressKey('Meta+I');
    await page.wait(1);

    const typed = await page.evaluate(
      `(function(text) {
        let composer = document.activeElement;
        if (!composer || !composer.isContentEditable) {
            composer = document.querySelector('.composer-bar [data-lexical-editor="true"], [id*="composer"] [contenteditable="true"], .aislash-editor-input');
        }
        
        if (!composer) return false;

        composer.focus();
        document.execCommand('insertText', false, text);
        return true;
      })(${JSON.stringify(textToInsert)})`
    );

    if (!typed) {
      throw new SelectorError('Cursor Composer input element', 'Could not find Cursor Composer input element after pressing Cmd+I.');
    }

    await page.wait(0.5);
    await page.pressKey('Enter');
    await page.wait(1);

    return [
      {
        Status: 'Success',
        InjectedText: textToInsert,
      },
    ];
  },
});
