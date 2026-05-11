import { cli, Strategy } from '@jackwener/opencli/registry';
import { selectorError } from '@jackwener/opencli/errors';
export const composerCommand = cli({
    site: 'cursor',
    name: 'composer',
    access: 'write',
    description: 'Send a prompt directly into Cursor Composer (Cmd+I shortcut)',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [{ name: 'text', required: true, positional: true, help: 'Text to send into Composer' }],
    columns: ['Status', 'InjectedText'],
    func: async (page, kwargs) => {
        const textToInsert = kwargs.text;
        // Open/Focus Composer via shortcut — always works regardless of current state
        await page.pressKey('Meta+I');
        await page.wait(1);
        const typed = await page.evaluate(`(function(text) {
        let composer = document.activeElement;
        if (!composer || !composer.isContentEditable) {
            composer = document.querySelector('.composer-bar [data-lexical-editor="true"], [id*="composer"] [contenteditable="true"], .aislash-editor-input');
        }
        
        if (!composer) return false;

        composer.focus();
        document.execCommand('insertText', false, text);
        return true;
      })(${JSON.stringify(textToInsert)})`);
        if (!typed) {
            throw selectorError('Cursor Composer input element', 'Could not find Cursor Composer input element after pressing Cmd+I.');
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
